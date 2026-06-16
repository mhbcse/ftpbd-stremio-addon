// Stremio meta/stream ids must round-trip through the catalog -> meta -> stream
// handlers. We encode the absolute folder URL of a movie into the id so every
// handler is stateless: it can recover the exact FTP location from the id alone.

const PREFIX = 'ftpbd:';

function encodeId(folderUrl) {
  return PREFIX + Buffer.from(folderUrl, 'utf8').toString('base64url');
}

function decodeId(id) {
  if (!id || !id.startsWith(PREFIX)) return null;
  try {
    return Buffer.from(id.slice(PREFIX.length), 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function isOurId(id) {
  return typeof id === 'string' && id.startsWith(PREFIX);
}

module.exports = { encodeId, decodeId, isOurId };
