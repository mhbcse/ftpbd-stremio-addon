// Builds the Stremio addon interface: manifest + catalog/meta/stream handlers.
//
// Supports several source layouts (see config.js): movie sources organized by
// year / language / flat, and TV-series sources (show -> season -> episode).
// Matched titles use their real IMDB id (so Cinemeta metadata + OpenSubtitles
// work); unmatched titles fall back to our own folder-encoded `ftpbd:` ids.

const { addonBuilder } = require('stremio-addon-sdk');
const config = require('./config');
const cache = require('./lib/cache');
const scraper = require('./lib/scraper');
const cinemeta = require('./lib/cinemeta');
const { encodeId, decodeId } = require('./lib/id');

const { SOURCES, PAGE_SIZE, ENRICH_CONCURRENCY, CACHE_TTL_MS } = config;

const catalogToSource = new Map(SOURCES.map((s) => [`ftpbd-${s.id}`, s]));

function layoutOf(source) {
  return source.layout || 'year';
}
function stremioType(source) {
  return layoutOf(source) === 'series' ? 'series' : 'movie';
}

// ---- helpers ---------------------------------------------------------------

// Run async `fn` over `items` with a fixed concurrency, preserving order.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function normalizeTitle(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function yearOf(s) {
  const m = String(s || '').match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

function isImdbId(id) {
  return typeof id === 'string' && /^tt\d+/.test(id);
}

function lastSegmentName(url) {
  try {
    return decodeURIComponent(url.replace(/\/+$/, '').split('/').pop() || '');
  } catch {
    return '';
  }
}

// Build a Stremio stream object from a discovered video file.
function buildStream(video) {
  const parsed = scraper.parseMovieName(video.name);
  const tags = [parsed.quality, parsed.source].filter(Boolean).join(' ');
  return {
    url: video.url,
    name: 'FTPBD' + (parsed.quality ? `\n${parsed.quality}` : ''),
    title: `${video.name}${tags ? `\n${tags}` : ''}`,
    behaviorHints: { notWebReady: false, bingeGroup: `ftpbd-${parsed.quality || 'sd'}` }
  };
}

// Whole-source index (flat list of movies or shows), cached. Used for search,
// default browse of non-year layouts, and IMDB -> file resolution.
async function buildIndex(source) {
  return cache.remember(`index:${source.id}`, CACHE_TTL_MS, async () => {
    const layout = layoutOf(source);
    if (layout === 'flat' || layout === 'series') {
      const items = await scraper.listMovies(source.baseUrl);
      return items.map((it) => ({ name: it.name, url: it.url }));
    }
    // grouped: year or language
    const groups = await scraper.listGroups(source.baseUrl, layout);
    const lists = await mapLimit(groups, 6, async (g) => {
      try {
        const items = await scraper.listMovies(g.url);
        return items.map((it) => ({ name: it.name, url: it.url, group: g.name, year: g.year }));
      } catch {
        return [];
      }
    });
    return lists.flat();
  });
}

// Collect a show's episodes with resolved { season, episode }. Handles shows
// with Season-N sub-folders and shows whose episodes sit directly inside.
async function collectEpisodes(showUrl) {
  const seasons = await scraper.listSeasons(showUrl);
  const seasonList = seasons.length ? seasons : [{ url: showUrl, season: 1 }];
  const out = [];
  for (const s of seasonList) {
    const seasonNum = s.season || 1;
    let eps;
    try {
      eps = await scraper.listEpisodes(s.url);
    } catch {
      eps = [];
    }
    eps.sort((a, b) => (a.episode || 0) - (b.episode || 0));
    let counter = 0;
    for (const ep of eps) {
      counter++;
      out.push({
        name: ep.name,
        url: ep.url,
        season: ep.season || seasonNum,
        episode: ep.episode || counter
      });
    }
  }
  return out;
}

// ---- catalog ---------------------------------------------------------------

async function toCatalogMeta(item, source) {
  const type = stremioType(source);
  const parsed = scraper.parseMovieName(item.name);
  const match = await cinemeta.search(parsed.title, parsed.year, type).catch(() => null);

  // Prefer the real IMDB id so Stremio treats this as a known title (enables
  // Cinemeta metadata + OpenSubtitles); fall back to our folder-encoded id.
  const id = match && isImdbId(match.id) ? match.id : encodeId(item.url);

  return {
    id,
    type,
    name: (match && match.name) || parsed.title || parsed.raw,
    poster: match && match.poster,
    posterShape: 'poster',
    background: match && match.background,
    releaseInfo: (match && match.releaseInfo) || parsed.year || undefined,
    description:
      (match && match.description ? match.description + '\n\n' : '') + `FTPBD: ${parsed.raw}`,
    imdbRating: match && match.imdbRating,
    genres: match && match.genres
  };
}

async function catalogHandler({ id, extra }) {
  const source = catalogToSource.get(id);
  if (!source) return { metas: [] };

  const layout = layoutOf(source);
  const skip = parseInt((extra && extra.skip) || 0, 10) || 0;
  const search = extra && extra.search;
  const genre = extra && extra.genre;

  let items;
  if (search) {
    const index = await buildIndex(source);
    const q = search.toLowerCase();
    items = index.filter((m) => m.name.toLowerCase().includes(q));
  } else if (genre && (layout === 'year' || layout === 'language')) {
    const groups = await scraper.listGroups(source.baseUrl, layout);
    const g = groups.find((x) => x.name === genre) || groups[0];
    items = g ? await scraper.listMovies(g.url) : [];
  } else if (layout === 'year') {
    // default browse: newest year
    const groups = await scraper.listGroups(source.baseUrl, 'year');
    items = groups.length ? await scraper.listMovies(groups[0].url) : [];
  } else {
    // language / flat / series default browse: first page of the full index
    items = await buildIndex(source);
  }

  const page = items.slice(skip, skip + PAGE_SIZE);
  const metas = await mapLimit(page, ENRICH_CONCURRENCY, (it) => toCatalogMeta(it, source));

  // Collapse duplicates (e.g. same movie in several qualities share one IMDB id).
  const seen = new Set();
  const deduped = [];
  for (const m of metas) {
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    deduped.push(m);
  }
  return { metas: deduped };
}

// ---- meta (only for our fallback `ftpbd:` ids; Cinemeta owns IMDB ids) ------

async function metaHandler({ type, id }) {
  const url = decodeId(id);
  if (!url) return { meta: null };
  if (type === 'series') return { meta: await buildSeriesMeta(id, url) };
  return { meta: await buildMovieMeta(id, url) };
}

async function buildMovieMeta(id, folderUrl) {
  const parsed = scraper.parseMovieName(lastSegmentName(folderUrl));
  const match = await cinemeta.search(parsed.title, parsed.year, 'movie').catch(() => null);
  let full = null;
  if (match && match.id) full = await cinemeta.meta(match.id, 'movie').catch(() => null);
  const base = full || match || {};

  return {
    id,
    type: 'movie',
    name: base.name || parsed.title || parsed.raw,
    poster: base.poster,
    background: base.background,
    logo: base.logo,
    description:
      (base.description ? base.description + '\n\n' : '') + `Source: FTPBD\nFolder: ${parsed.raw}`,
    releaseInfo: base.releaseInfo || parsed.year || undefined,
    runtime: base.runtime,
    genres: base.genres,
    cast: base.cast,
    director: base.director,
    imdbRating: base.imdbRating
  };
}

async function buildSeriesMeta(id, showUrl) {
  const parsed = scraper.parseMovieName(lastSegmentName(showUrl));
  const match = await cinemeta.search(parsed.title, parsed.year, 'series').catch(() => null);
  let base = {};
  if (match && match.id) base = (await cinemeta.meta(match.id, 'series').catch(() => null)) || match;
  else if (match) base = match;

  const episodes = await collectEpisodes(showUrl);
  // Each fallback episode id encodes the file URL directly, so the stream
  // handler can resolve it without re-scraping.
  const videos = episodes.map((ep) => ({
    id: encodeId(ep.url),
    title: ep.name,
    season: ep.season,
    episode: ep.episode
  }));

  return {
    id,
    type: 'series',
    name: base.name || parsed.title || parsed.raw,
    poster: base.poster,
    background: base.background,
    logo: base.logo,
    description:
      (base.description ? base.description + '\n\n' : '') + `Source: FTPBD\nFolder: ${parsed.raw}`,
    releaseInfo: base.releaseInfo || parsed.year || undefined,
    genres: base.genres,
    videos
  };
}

// ---- stream ----------------------------------------------------------------

async function streamHandler({ type, id }) {
  if (type === 'series') {
    if (isImdbId(id)) return streamSeriesFromImdb(id);
    // fallback: the (custom) episode id encodes the file URL directly
    const fileUrl = decodeId(id);
    if (!fileUrl) return { streams: [] };
    return { streams: [buildStream({ name: lastSegmentName(fileUrl), url: fileUrl })] };
  }

  // movie
  if (isImdbId(id)) return streamFromImdb(id);
  const folderUrl = decodeId(id);
  if (!folderUrl) return { streams: [] };
  let videos;
  try {
    videos = await scraper.findVideos(folderUrl);
  } catch {
    return { streams: [] };
  }
  return { streams: videos.map(buildStream) };
}

// Movie: find every folder across movie sources matching an IMDB id.
async function streamFromImdb(imdbId) {
  return cache.remember(`streams:${imdbId}`, CACHE_TTL_MS, async () => {
    const meta = await cinemeta.meta(imdbId, 'movie').catch(() => null);
    if (!meta) return { streams: [] };

    const wantTitle = normalizeTitle(meta.name);
    const wantYear = yearOf(meta.releaseInfo || meta.year);

    const matches = [];
    for (const source of SOURCES) {
      if (stremioType(source) !== 'movie') continue;
      let index;
      try {
        index = await buildIndex(source);
      } catch {
        continue;
      }
      for (const mv of index) {
        const p = scraper.parseMovieName(mv.name);
        if (normalizeTitle(p.title) !== wantTitle) continue;
        if (wantYear && p.year && Math.abs(Number(p.year) - wantYear) > 1) continue;
        matches.push(mv);
      }
    }

    const streams = [];
    for (const mv of matches) {
      const videos = await scraper.findVideos(mv.url).catch(() => []);
      for (const v of videos) streams.push(buildStream(v));
    }
    return { streams };
  });
}

// Series: id is `ttXXXXXXX:season:episode`. Resolve to the episode file.
async function streamSeriesFromImdb(fullId) {
  return cache.remember(`streams:${fullId}`, CACHE_TTL_MS, async () => {
    const [imdbId, sStr, eStr] = fullId.split(':');
    const season = parseInt(sStr, 10);
    const episode = parseInt(eStr, 10);
    if (!season || !episode) return { streams: [] };

    const meta = await cinemeta.meta(imdbId, 'series').catch(() => null);
    if (!meta) return { streams: [] };

    const wantTitle = normalizeTitle(meta.name);
    const wantYear = yearOf(meta.releaseInfo || meta.year);

    const streams = [];
    for (const source of SOURCES) {
      if (layoutOf(source) !== 'series') continue;
      let shows;
      try {
        shows = await buildIndex(source);
      } catch {
        continue;
      }
      for (const show of shows) {
        const p = scraper.parseMovieName(show.name);
        if (normalizeTitle(p.title) !== wantTitle) continue;
        // series titles can span multiple years; be lenient
        if (wantYear && p.year && Math.abs(Number(p.year) - wantYear) > 2) continue;

        const episodes = await collectEpisodes(show.url).catch(() => []);
        for (const ep of episodes) {
          if (ep.season === season && ep.episode === episode) {
            streams.push(buildStream({ name: ep.name, url: ep.url }));
          }
        }
      }
    }
    return { streams };
  });
}

// ---- manifest / builder ----------------------------------------------------

async function buildManifest() {
  const catalogs = [];
  for (const source of SOURCES) {
    const layout = layoutOf(source);
    const extra = [{ name: 'search', isRequired: false }];

    if (layout === 'year' || layout === 'language') {
      let options = [];
      try {
        options = (await scraper.listGroups(source.baseUrl, layout)).map((g) => g.name);
      } catch {
        // ship without the filter if the base listing fails at startup
      }
      extra.push({ name: 'genre', isRequired: false, options });
    }
    extra.push({ name: 'skip', isRequired: false });

    catalogs.push({
      type: stremioType(source),
      id: `ftpbd-${source.id}`,
      name: source.name,
      extra
    });
  }

  return {
    id: 'community.ftpbd.movies',
    version: '2.0.0',
    name: 'FTPBD Movies',
    description:
      'Browse and stream movies & TV series indexed on the FTPBD server, with posters, metadata and subtitles matched via Cinemeta/IMDB.',
    logo: 'https://www.ftpbd.net/favicon.ico',
    resources: [
      'catalog',
      // Streams for real IMDB movies/series AND our fallback ids.
      { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'ftpbd:'] },
      // Meta only for our fallback ids; Cinemeta owns IMDB metadata.
      { name: 'meta', types: ['movie', 'series'], idPrefixes: ['ftpbd:'] }
    ],
    types: ['movie', 'series'],
    idPrefixes: ['tt', 'ftpbd:'],
    catalogs,
    behaviorHints: { configurable: false }
  };
}

async function createAddon() {
  const manifest = await buildManifest();
  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(catalogHandler);
  builder.defineMetaHandler(metaHandler);
  builder.defineStreamHandler(streamHandler);

  return builder.getInterface();
}

module.exports = {
  createAddon,
  _internals: { catalogHandler, metaHandler, streamHandler, buildSeriesMeta, collectEpisodes }
};
