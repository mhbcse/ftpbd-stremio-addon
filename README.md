# FTPBD Stremio Addon

A [Stremio](https://www.stremio.com/) addon that browses and streams movies
indexed on the **FTPBD** server (`ftpbd.net`, h5ai directory listings) directly
inside Stremio — with posters, descriptions and ratings pulled from Cinemeta.

The video files are served over HTTPS with byte-range support, so seeking and
scrubbing work normally; nothing is proxied or re-encoded by the addon.

## ⚠️ Network requirement (important)

The FTPBD servers are **only reachable from the ISP/home network they belong to**
— not from cloud datacenters. This means:

- The addon must run on a machine **on that home network** (your PC, or an
  always-on home device like a Pi/NAS). Cloud hosting (Render, Fly, Cloudflare,
  a VPS, …) **cannot reach FTPBD and will not work**.
- The stream URLs also only resolve on that network, so the device running
  **Stremio must be on the home network too**.

## Features

- **Browsable catalog** of movies, filterable by **year** and **searchable**.
- **Poster / metadata matching** via Cinemeta (Stremio's public metadata API).
- **Direct HTTPS streams** with quality tags (1080p / 720p / 4K, BluRay/WEBRip…).
- In-memory **caching** so browsing stays fast.
- **Stateless ids** — each movie's id encodes its folder URL, so meta and stream
  resolution never depends on server state.

## Requirements

- Node.js **18+** (uses the built-in `fetch`).

## Run locally

```bash
npm install
npm start
```

You'll see:

```
Manifest:  http://127.0.0.1:7000/manifest.json
```

### Install in Stremio

1. Open Stremio (desktop or web).
2. Go to **Addons** → search bar at the top → paste:
   `http://127.0.0.1:7000/manifest.json`
3. Click **Install**.

A new **FTPBD English Movies** catalog appears under Discover/Board. Open any
movie and pick the **FTPBD** stream to play.

> `npm start` only runs while the terminal is open. For an always-on setup that
> survives reboots, install it as a service — see [Always-on](#always-on-systemd) below.

## Configuration

Everything lives in [`config.js`](./config.js):

- `PORT` — HTTP port (default `7000`, or `PORT` env var).
- `CACHE_TTL_MS` — how long directory listings are cached (default 30 min).
- `PAGE_SIZE` — movies per catalog page.
- `SOURCES` — the categories to expose. Each becomes its own catalog.

### Add more categories

Each source's `baseUrl` must point at a folder whose **immediate children are
year folders**, and each year folder contains **one sub-folder per movie**.
Uncomment / add entries in `config.js`, e.g.:

```js
{ id: 'hindi', name: 'FTPBD Hindi Movies',
  baseUrl: 'https://server3.ftpbd.net/FTP-3/Hindi%20Movies/' }
```

Restart the addon and a new catalog shows up.

## How it works

```
config.js          source definitions (base URLs)
server.js          HTTP server (getRouter + express), binds HOST:PORT
addon.js           manifest + catalog / meta / stream handlers
lib/scraper.js     parses h5ai listings: years -> movies -> video files
lib/cinemeta.js    poster/metadata lookup (Cinemeta)
lib/http.js        fetch helpers (UA + timeout)
lib/cache.js       in-memory TTL cache
lib/id.js          encode/decode folder URL <-> Stremio id
```

- **Catalog** — lists movie folders for the selected year (or search across the
  full index), then enriches each with a Cinemeta poster/title.
- **Meta** — returns the full Cinemeta document for the matched title.
- **Stream** — opens the movie folder, finds the video file, returns its direct
  HTTPS URL.

## Always-on (systemd)

Run it as a background service so it starts on boot and restarts on crash — no
terminal needed. Because FTPBD is home-network only (see above), this runs on a
machine **on your home network**, not in the cloud.

A ready-to-use unit is in [`deploy/ftpbd-addon.service`](./deploy/ftpbd-addon.service).
Install it as a **user service** (no root needed):

```bash
# 1. copy the unit, editing the node path / project path inside it if needed
mkdir -p ~/.config/systemd/user
cp deploy/ftpbd-addon.service ~/.config/systemd/user/

# 2. enable + start it
systemctl --user daemon-reload
systemctl --user enable --now ftpbd-addon

# 3. keep it running across reboots without logging in
loginctl enable-linger "$USER"
```

Manage it:

```bash
systemctl --user status ftpbd-addon     # is it running?
systemctl --user restart ftpbd-addon    # after editing config.js
journalctl --user -u ftpbd-addon -f     # live logs
```

It listens on `127.0.0.1:7000` by default (localhost only). To let other devices
on your home network (phone/TV) reach it, set `HOST=0.0.0.0` in the unit and
install `http://<this-machine-LAN-IP>:7000/manifest.json` on those devices.

## Notes / limitations

- This reads a **public third-party index**; availability and folder naming are
  outside our control. If a listing layout changes, `lib/scraper.js` is where to
  adjust parsing.
- Metadata matching is best-effort by title+year; obscure releases may not match
  a Cinemeta poster (they still play — the card just shows the parsed title).
- Movies only for now (TV series use a different season/episode layout).
