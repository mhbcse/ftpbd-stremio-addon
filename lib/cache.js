// Tiny in-memory TTL cache. Good enough for a single-process addon; swap for
// Redis if you ever run multiple instances.

const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

// Run `producer` only if `key` is missing/expired, then cache the result.
async function remember(key, ttlMs, producer) {
  const cached = get(key);
  if (cached !== null) return cached;
  const value = await producer();
  return set(key, value, ttlMs);
}

module.exports = { get, set, remember };
