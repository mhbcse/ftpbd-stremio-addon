// Configuration for the FTPBD Stremio addon.
//
// To add more categories later, append entries to SOURCES. Each source
// becomes its own browsable catalog in Stremio. `baseUrl` must point at a
// directory whose immediate children are YEAR folders (h5ai style), and each
// year folder contains one sub-folder per movie holding the video file.

module.exports = {
  PORT: process.env.PORT || 7000,

  // How long scraped directory listings / metadata are kept in memory.
  CACHE_TTL_MS: 1000 * 60 * 30, // 30 minutes

  // Number of movies returned per catalog page.
  PAGE_SIZE: 50,

  // Concurrency when enriching a page with Cinemeta metadata.
  ENRICH_CONCURRENCY: 8,

  SOURCES: [
    {
      id: 'english',
      name: 'FTPBD English Movies',
      baseUrl: 'https://server2.ftpbd.net/FTP-2/English%20Movies/'
    }
    // Examples you can enable later:
    // { id: 'english4k', name: 'FTPBD English 4K',  baseUrl: 'https://server2.ftpbd.net/FTP-2/English%20Movies/English-Movies-4K/' },
    // { id: 'hindi',     name: 'FTPBD Hindi Movies', baseUrl: 'https://server3.ftpbd.net/FTP-3/Hindi%20Movies/' },
    // { id: 'foreign',   name: 'FTPBD Foreign Movies', baseUrl: 'https://server3.ftpbd.net/FTP-3/Foreign%20Language%20Movies/' }
  ],

  VIDEO_EXTENSIONS: ['.mp4', '.mkv', '.avi', '.m4v', '.webm', '.mov', '.ts'],

  CINEMETA_BASE: 'https://v3-cinemeta.strem.io'
};
