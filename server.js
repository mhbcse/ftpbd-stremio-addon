const express = require('express');
const getRouter = require('stremio-addon-sdk/src/getRouter');
const { createAddon } = require('./addon');
const { PORT } = require('./config');

// Bind to localhost by default so the Node process isn't exposed publicly; in
// production nginx terminates TLS and reverse-proxies to it. Set HOST=0.0.0.0
// only if you intend to reach the addon directly without a proxy.
const HOST = process.env.HOST || '127.0.0.1';

(async () => {
  try {
    const addonInterface = await createAddon();

    const app = express();
    app.disable('x-powered-by');
    app.use(getRouter(addonInterface));
    app.get('/', (_req, res) => res.redirect('/manifest.json'));

    app.listen(PORT, HOST, () => {
      console.log('');
      console.log('  FTPBD Stremio addon running.');
      console.log(`  Listening on http://${HOST}:${PORT}/manifest.json`);
      console.log('');
    });
  } catch (err) {
    console.error('Failed to start addon:', err);
    process.exit(1);
  }
})();
