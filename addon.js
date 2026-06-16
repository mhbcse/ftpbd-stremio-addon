// Builds the Stremio addon interface: manifest + catalog/meta/stream handlers.

const { addonBuilder } = require('stremio-addon-sdk');
const config = require('./config');
const cache = require('./lib/cache');
const scraper = require('./lib/scraper');
const cinemeta = require('./lib/cinemeta');
const { encodeId, decodeId } = require('./lib/id');

const { SOURCES, PAGE_SIZE, ENRICH_CONCURRENCY, CACHE_TTL_MS } = config;

const sourceById = new Map(SOURCES.map((s) => [s.id, s]));
const catalogToSource = new Map(SOURCES.map((s) => [`ftpbd-${s.id}`, s]));

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

// Normalize a title for fuzzy equality: lowercase, strip everything non-alphanumeric.
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

// Build a catalog meta-preview from a movie folder, enriched via Cinemeta.
async function toCatalogMeta(movie) {
  const parsed = scraper.parseMovieName(movie.name);
  const match = await cinemeta.search(parsed.title, parsed.year).catch(() => null);

  // Prefer the real IMDB id so Stremio treats this as a known movie — that's
  // what makes Cinemeta metadata and OpenSubtitles addons kick in. Fall back to
  // our own folder-encoded id when Cinemeta can't match the title.
  const id = match && isImdbId(match.id) ? match.id : encodeId(movie.url);

  const qualityTag = parsed.quality ? ` • ${parsed.quality}` : '';

  return {
    id,
    type: 'movie',
    name: (match && match.name) || parsed.title || parsed.raw,
    poster: match && match.poster,
    posterShape: 'poster',
    background: match && match.background,
    releaseInfo: (match && match.releaseInfo) || parsed.year || undefined,
    description:
      (match && match.description
        ? match.description + '\n\n'
        : '') + `FTPBD: ${parsed.raw}${qualityTag}`,
    imdbRating: match && match.imdbRating,
    genres: match && match.genres
  };
}

// Whole-source index (all years flattened), cached. Used for search.
async function buildIndex(source) {
  return cache.remember(`index:${source.id}`, CACHE_TTL_MS, async () => {
    const years = await scraper.listYears(source.baseUrl);
    const all = [];
    for (const y of years) {
      try {
        const movies = await scraper.listMovies(y.url);
        for (const mv of movies) all.push({ ...mv, year: y.year });
      } catch {
        // skip a year that fails to load rather than failing the whole index
      }
    }
    return all;
  });
}

// ---- handlers --------------------------------------------------------------

async function catalogHandler({ id, extra }) {
  const source = catalogToSource.get(id);
  if (!source) return { metas: [] };

  const skip = parseInt((extra && extra.skip) || 0, 10) || 0;
  const search = extra && extra.search;
  const genre = extra && extra.genre; // a year-folder name

  let movies;
  if (search) {
    const index = await buildIndex(source);
    const q = search.toLowerCase();
    movies = index.filter((m) => m.name.toLowerCase().includes(q));
  } else if (genre) {
    const years = await scraper.listYears(source.baseUrl);
    const year = years.find((y) => y.name === genre) || years[0];
    movies = year ? await scraper.listMovies(year.url) : [];
  } else {
    // Default browse: newest year.
    const years = await scraper.listYears(source.baseUrl);
    movies = years.length ? await scraper.listMovies(years[0].url) : [];
  }

  const page = movies.slice(skip, skip + PAGE_SIZE);
  const metas = await mapLimit(page, ENRICH_CONCURRENCY, (mv) => toCatalogMeta(mv));

  // Collapse duplicates: the same movie in several qualities shares one IMDB id
  // and should appear once (its qualities surface as separate streams).
  const seen = new Set();
  const deduped = [];
  for (const m of metas) {
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    deduped.push(m);
  }
  return { metas: deduped };
}

async function metaHandler({ id }) {
  const folderUrl = decodeId(id);
  if (!folderUrl) return { meta: null };

  const folderName = decodeURIComponent(folderUrl.replace(/\/+$/, '').split('/').pop() || '');
  const parsed = scraper.parseMovieName(folderName);
  const match = await cinemeta.search(parsed.title, parsed.year).catch(() => null);

  let full = null;
  if (match && match.id) full = await cinemeta.meta(match.id).catch(() => null);
  const base = full || match || {};

  const meta = {
    id,
    type: 'movie',
    name: base.name || parsed.title || parsed.raw,
    poster: base.poster,
    background: base.background,
    logo: base.logo,
    description:
      (base.description ? base.description + '\n\n' : '') +
      `Source: FTPBD\nFolder: ${parsed.raw}`,
    releaseInfo: base.releaseInfo || parsed.year || undefined,
    runtime: base.runtime,
    genres: base.genres,
    cast: base.cast,
    director: base.director,
    imdbRating: base.imdbRating
  };

  return { meta };
}

async function streamHandler({ id }) {
  if (isImdbId(id)) return streamFromImdb(id);

  // Fallback: our own folder-encoded id (movies Cinemeta couldn't match).
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

// Find every FTPBD folder across all sources that matches an IMDB id, then
// return one stream per video file (so multiple qualities all show up).
async function streamFromImdb(imdbId) {
  return cache.remember(`streams:${imdbId}`, CACHE_TTL_MS, async () => {
    const meta = await cinemeta.meta(imdbId).catch(() => null);
    if (!meta) return { streams: [] };

    const wantTitle = normalizeTitle(meta.name);
    const wantYear = yearOf(meta.releaseInfo || meta.year);

    const matches = [];
    for (const source of SOURCES) {
      let index;
      try {
        index = await buildIndex(source);
      } catch {
        continue;
      }
      for (const mv of index) {
        const parsed = scraper.parseMovieName(mv.name);
        if (normalizeTitle(parsed.title) !== wantTitle) continue;
        if (wantYear && parsed.year && Math.abs(Number(parsed.year) - wantYear) > 1) continue;
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

// ---- manifest / builder ----------------------------------------------------

async function buildManifest() {
  const catalogs = [];
  for (const source of SOURCES) {
    let genreOptions = [];
    try {
      const years = await scraper.listYears(source.baseUrl);
      genreOptions = years.map((y) => y.name);
    } catch {
      // If startup scrape fails, ship without year filter; browse/search still work.
    }
    catalogs.push({
      type: 'movie',
      id: `ftpbd-${source.id}`,
      name: source.name,
      extra: [
        { name: 'search', isRequired: false },
        { name: 'genre', isRequired: false, options: genreOptions },
        { name: 'skip', isRequired: false }
      ]
    });
  }

  return {
    id: 'community.ftpbd.movies',
    version: '1.0.0',
    name: 'FTPBD Movies',
    description:
      'Browse and stream movies indexed on the FTPBD server, with posters and metadata from Cinemeta.',
    logo: 'https://www.ftpbd.net/favicon.ico',
    resources: [
      'catalog',
      // Provide streams for real IMDB movies (so subtitles/metadata addons work)
      // AND for our fallback folder ids.
      { name: 'stream', types: ['movie'], idPrefixes: ['tt', 'ftpbd:'] },
      // Only serve meta for our fallback ids; Cinemeta owns IMDB metadata.
      { name: 'meta', types: ['movie'], idPrefixes: ['ftpbd:'] }
    ],
    types: ['movie'],
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

module.exports = { createAddon, _internals: { catalogHandler, metaHandler, streamHandler } };
