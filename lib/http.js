// Thin fetch wrappers with a browser-ish User-Agent and a timeout, since the
// FTPBD h5ai servers can be slow and occasionally reject default agents.

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function timeoutSignal(ms) {
  // AbortSignal.timeout exists on Node 18+, but guard just in case.
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    return AbortSignal.timeout(ms);
  }
  const ac = new AbortController();
  setTimeout(() => ac.abort(), ms);
  return ac.signal;
}

async function getText(url, ms = 20000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
    signal: timeoutSignal(ms)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function getJson(url, ms = 15000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: timeoutSignal(ms)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

module.exports = { getText, getJson };
