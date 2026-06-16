// Looks up rich metadata (poster, description, imdb id, ...) from Cinemeta,
// Stremio's free public metadata API. Used to turn an ugly folder name into a
// proper movie card.

const { getJson } = require('./http');
const { remember } = require('./cache');
const { CACHE_TTL_MS, CINEMETA_BASE } = require('../config');

// Cache metadata longer than directory listings; it rarely changes.
const META_TTL = CACHE_TTL_MS * 4;

// Find the best-matching Cinemeta entry (movie or series) for a parsed
// title/year. `type` is 'movie' or 'series'.
async function search(title, year, type = 'movie') {
  if (!title) return null;
  const key = `cinemeta:search:${type}:${title.toLowerCase()}:${year || ''}`;

  return remember(key, META_TTL, async () => {
    const url = `${CINEMETA_BASE}/catalog/${type}/top/search=${encodeURIComponent(title)}.json`;
    let data;
    try {
      data = await getJson(url);
    } catch {
      return null;
    }
    const metas = (data && data.metas) || [];
    if (!metas.length) return null;

    if (year) {
      const byYear = metas.find((m) => String(m.releaseInfo || m.year || '').includes(year));
      if (byYear) return byYear;
    }
    // Fall back to the closest title match (first result is Cinemeta's best).
    return metas[0];
  });
}

// Full meta document for a known imdb id ('movie' or 'series').
async function meta(imdbId, type = 'movie') {
  if (!imdbId) return null;
  const key = `cinemeta:meta:${type}:${imdbId}`;
  return remember(key, META_TTL, async () => {
    const url = `${CINEMETA_BASE}/meta/${type}/${imdbId}.json`;
    try {
      const data = await getJson(url);
      return (data && data.meta) || null;
    } catch {
      return null;
    }
  });
}

module.exports = { search, meta };
