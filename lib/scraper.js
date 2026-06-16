// Scrapes the FTPBD h5ai directory listings.
//
// Structure (per source baseUrl):
//   baseUrl/                     -> year folders (2025/, 2024/, ... 1995--Before/)
//   baseUrl/<year>/              -> one folder per movie
//   baseUrl/<year>/<movie>/      -> the actual video file(s)

const { getText } = require('./http');
const { remember } = require('./cache');
const { CACHE_TTL_MS, VIDEO_EXTENSIONS } = require('../config');

// Pull the direct children (files + folders) out of an h5ai HTML listing.
function parseEntries(html, pageUrl) {
  const entries = [];
  const seen = new Set();
  const pagePath = new URL(pageUrl).pathname;
  const re = /href\s*=\s*"([^"]+)"/gi;
  let m;

  while ((m = re.exec(html))) {
    const raw = m[1];
    if (!raw || raw.startsWith('#') || raw.startsWith('?')) continue;
    if (raw.includes('/_h5ai/')) continue; // h5ai's own assets

    let abs;
    try {
      abs = new URL(raw, pageUrl);
    } catch {
      continue;
    }

    const path = abs.pathname;
    if (!path.startsWith(pagePath) || path === pagePath) continue;

    const rel = path.slice(pagePath.length);
    const isDir = rel.endsWith('/');
    const inner = isDir ? rel.slice(0, -1) : rel;
    if (!inner || inner.includes('/')) continue; // direct children only

    if (seen.has(path)) continue;
    seen.add(path);

    entries.push({
      name: safeDecode(inner),
      href: abs.href,
      isDir
    });
  }

  return entries;
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function hasYear(name) {
  return /(?:19|20)\d{2}/.test(name);
}

function isVideo(name) {
  const lower = name.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function listing(url) {
  return remember(`listing:${url}`, CACHE_TTL_MS, async () => {
    const html = await getText(url);
    return parseEntries(html, url);
  });
}

// Year folders under a source, newest first.
async function listYears(baseUrl) {
  const entries = await listing(baseUrl);
  return entries
    .filter((e) => e.isDir && hasYear(e.name))
    .map((e) => ({ name: e.name, url: e.href, year: extractYear(e.name) }))
    .sort((a, b) => (b.year || 0) - (a.year || 0));
}

// Sub-folders inside a folder (movies inside a year/language, or shows/seasons).
async function listMovies(url) {
  const entries = await listing(url);
  return entries.filter((e) => e.isDir).map((e) => ({ name: e.name, url: e.href }));
}

// Grouping folders directly under a source base, per layout:
//   'year'     -> year folders, newest first (with numeric `year`)
//   'language' -> language folders, alphabetical
//   else (flat/series) -> no groups
async function listGroups(baseUrl, layout) {
  const entries = await listing(baseUrl);
  const dirs = entries.filter((e) => e.isDir);
  if (layout === 'year') {
    return dirs
      .filter((e) => hasYear(e.name))
      .map((e) => ({ name: e.name, url: e.href, year: extractYear(e.name) }))
      .sort((a, b) => (b.year || 0) - (a.year || 0));
  }
  if (layout === 'language') {
    return dirs
      .map((e) => ({ name: e.name, url: e.href }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return [];
}

// ----- TV series helpers -----

function parseSeasonNum(name) {
  const m = name.match(/season[\s._-]*0*(\d{1,2})/i) || name.match(/^s0*(\d{1,2})$/i);
  return m ? parseInt(m[1], 10) : null;
}

// Extract { season, episode } from an episode filename. Handles S01E02,
// S01-E02, S1.E2, 1x02, and bare "Episode 2" / "E02" (season unknown -> null).
function parseEpisode(name) {
  let m = name.match(/S0*(\d{1,2})[\s._-]*E0*(\d{1,3})/i);
  if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
  m = name.match(/\b0*(\d{1,2})x0*(\d{1,3})\b/i);
  if (m) return { season: parseInt(m[1], 10), episode: parseInt(m[2], 10) };
  m = name.match(/episode[\s._-]*0*(\d{1,3})/i);
  if (m) return { season: null, episode: parseInt(m[1], 10) };
  m = name.match(/\bE0*(\d{1,3})\b/i);
  if (m) return { season: null, episode: parseInt(m[1], 10) };
  return { season: null, episode: null };
}

// Season folders inside a show folder.
async function listSeasons(showUrl) {
  const entries = await listing(showUrl);
  return entries
    .filter((e) => e.isDir)
    .map((e) => ({ name: e.name, url: e.href, season: parseSeasonNum(e.name) }));
}

// Episode video files inside a season (or show) folder.
async function listEpisodes(seasonUrl) {
  const entries = await listing(seasonUrl);
  return entries
    .filter((e) => !e.isDir && isVideo(e.name))
    .map((e) => ({ name: e.name, url: e.href, ...parseEpisode(e.name) }));
}

// Video file(s) inside a movie folder. Recurses one level if the folder only
// contains sub-folders (some releases nest the video).
async function findVideos(movieUrl, depth = 0) {
  const entries = await listing(movieUrl);
  const videos = entries.filter((e) => !e.isDir && isVideo(e.name));
  if (videos.length) return videos.map((v) => ({ name: v.name, url: v.href }));

  if (depth < 1) {
    const subdirs = entries.filter((e) => e.isDir);
    for (const dir of subdirs) {
      const nested = await findVideos(dir.href, depth + 1);
      if (nested.length) return nested;
    }
  }
  return [];
}

function extractYear(name) {
  const m = name.match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

const QUALITY_TOKENS = ['2160p', '4k', '1080p', '720p', '480p'];
const SOURCE_TOKENS = ['bluray', 'web-dl', 'webdl', 'webrip', 'hdrip', 'hdtv', 'dvdrip', 'brrip'];

// Turn a messy folder name into a clean { title, year, quality } guess.
function parseMovieName(folderName) {
  const decoded = safeDecode(folderName).replace(/\/+$/, '');
  const lower = decoded.toLowerCase();

  const yearMatch = decoded.match(/\(?((?:19|20)\d{2})\)?/);
  const year = yearMatch ? yearMatch[1] : null;

  let title = yearMatch ? decoded.slice(0, yearMatch.index) : decoded;
  title = title
    .replace(/[._]+/g, ' ')
    .replace(/-+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) title = decoded.replace(/[._-]+/g, ' ').trim();

  const quality = QUALITY_TOKENS.find((q) => lower.includes(q));
  const source = SOURCE_TOKENS.find((s) => lower.includes(s));

  return {
    title,
    year,
    quality: quality ? quality.toUpperCase().replace('4K', '4K') : null,
    source: source ? source.toUpperCase() : null,
    raw: decoded
  };
}

module.exports = {
  parseEntries,
  listYears,
  listGroups,
  listMovies,
  findVideos,
  listSeasons,
  listEpisodes,
  parseSeasonNum,
  parseEpisode,
  parseMovieName,
  extractYear
};
