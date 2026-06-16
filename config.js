// Configuration for the FTPBD Stremio addon.
//
// Each SOURCES entry becomes its own browsable catalog in Stremio. A source's
// `layout` tells the scraper how its folders are organized:
//
//   'year'     base / <year> / <movie> / video       (default, e.g. English Movies)
//   'language' base / <language> / <movie> / video    (e.g. Foreign Language Movies)
//   'flat'     base / <movie> / video                 (e.g. Awards & TV Shows)
//   'series'   base / <show> / <Season-N> / <S..E..>   (TV series)
//
// Movie layouts ('year'/'language'/'flat') produce a `movie` catalog; 'series'
// produces a `series` catalog with per-episode streams.

module.exports = {
  PORT: process.env.PORT || 7000,

  // How long scraped directory listings / metadata are kept in memory.
  CACHE_TTL_MS: 1000 * 60 * 30, // 30 minutes

  // Number of movies returned per catalog page.
  PAGE_SIZE: 50,

  // Concurrency when enriching a page with Cinemeta metadata.
  ENRICH_CONCURRENCY: 8,

  SOURCES: [
    // ---- Movies ----
    {
      id: 'english',
      name: 'FTPBD English Movies',
      baseUrl: 'https://server2.ftpbd.net/FTP-2/English%20Movies/',
      layout: 'year'
    },
    {
      id: 'english4k',
      name: 'FTPBD English 4K',
      baseUrl: 'https://server2.ftpbd.net/FTP-2/English%20Movies/English-Movies-4K/',
      layout: 'year'
    },
    {
      id: 'hindi',
      name: 'FTPBD Hindi Movies',
      baseUrl: 'https://server3.ftpbd.net/FTP-3/Hindi%20Movies/',
      layout: 'year'
    },
    {
      id: 'south',
      name: 'FTPBD South Indian Movies',
      baseUrl: 'https://server3.ftpbd.net/FTP-3/South%20Indian%20Movies/',
      layout: 'year'
    },
    {
      id: 'animation',
      name: 'FTPBD Animation Movies',
      baseUrl: 'https://server5.ftpbd.net/FTP-5/Animation%20Movies/',
      layout: 'year'
    },
    {
      id: 'bangla',
      name: 'FTPBD Bangla Movies',
      baseUrl: 'https://server3.ftpbd.net/FTP-3/Bangla%20Collection/BANGLA/Kolkata-Bangla-Movies/',
      layout: 'year'
    },
    {
      id: 'foreign',
      name: 'FTPBD Foreign Movies',
      baseUrl: 'https://server3.ftpbd.net/FTP-3/Foreign%20Language%20Movies/',
      layout: 'language'
    },
    {
      id: 'awards',
      name: 'FTPBD Awards & TV Shows',
      baseUrl: 'https://server7.ftpbd.net/FTP-7/Awards--TV-Shows/',
      layout: 'flat'
    },

    // ---- TV Series ----
    {
      id: 'tv-en',
      name: 'FTPBD English & Foreign TV Series',
      baseUrl: 'https://server4.ftpbd.net/FTP-4/English-Foreign-TV-Series/',
      layout: 'series'
    },
    {
      id: 'tv-hindi',
      name: 'FTPBD Hindi TV Series',
      baseUrl: 'https://server3.ftpbd.net/FTP-3/Hindi%20TV%20Series/',
      layout: 'series'
    },
    {
      id: 'tv-bengali',
      name: 'FTPBD Bengali Web Series',
      baseUrl: 'https://server3.ftpbd.net/FTP-3/Bangla%20Collection/BANGLA/Web-Series/',
      layout: 'series'
    }

    // More year-organized movie sections you can enable (verified compatible):
    // { id: 'dual', name: 'FTPBD Dual-Audio', baseUrl: 'https://server2.ftpbd.net/FTP-2/English%20Movies/Dual-Audio/', layout: 'year' },
    // { id: '3d',   name: 'FTPBD 3D Movies',  baseUrl: 'https://server2.ftpbd.net/FTP-2/3D%20Movies/', layout: 'year' },
  ],

  VIDEO_EXTENSIONS: ['.mp4', '.mkv', '.avi', '.m4v', '.webm', '.mov', '.ts'],

  CINEMETA_BASE: 'https://v3-cinemeta.strem.io'
};
