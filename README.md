# repiche.me

Draft clone of [piche.me](https://deriva-telar.fau.usp.br/piche-me/), the Brazilian social network (2011-2015) where anyone could "pichar" a virtual wall, no login needed.

Stack: Node.js + Express (API, JSON file storage) and Vue 3 (served locally, no build step).

## Run

```sh
npm install
npm start
```

Open http://localhost:3000. Any path is a wall: `/meunome` creates one on first visit.

## Deploy on Railway

1. New Project > Deploy from GitHub repo > pick this repo (Railway detects Node and runs `npm start`).
2. Add a **Volume** to the service and mount it at `/data`. Walls are stored in `db.json` there; without a volume they are lost on every deploy.
3. Service > Settings > Networking > **Generate Domain**.

Environment: `PORT` is set by Railway. `DATA_DIR` is optional; it defaults to the volume mount path (`RAILWAY_VOLUME_MOUNT_PATH`), then to `./data`. Health check: `GET /health`.

The JSON file store suits a single instance only (keep replicas at 1). Move to Postgres/SQLite before scaling.

## Features

- Anonymous walls by URL, scribbles with chosen font, color, size and weight
- Scribbles are immutable: text and position cannot be edited or moved once fixed (the API has no edit/delete routes); see below for when they vanish
- 2D wall: after "Pichar" drag the scribble anywhere and rotate it (-180° to 180°) with the "Girar" slider or a two-finger twist on touch screens, then "Fixar aqui". Position is saved and identical on every reload and for every visitor
- Very wide wall: 10080 px (50 m in 3D), constant `WALL_W` in `server.js` (the client reads it from `/api/meta`). Scroll sideways; starts centered. If you change it, existing scribbles are re-centered once on startup
- Creating a wall: opening an unused name with no scribbles shows "Crie seu muro" (name + color/texture). Nothing is stored until "Criar muro"
- Textured wall backgrounds (chosen once at creation, locked afterwards): 9 presets, or any color + one of 8 textures (brick, concrete, wood, paper, grunge, tiles, metal, plain), drawn with CSS/SVG (no image files)
- Zoom: in capped at 300%, out unlimited (floor 0.1%). +/- buttons, Ctrl/Cmd+wheel or trackpad pinch, two-finger pinch on phones.
- 3D view (cube button, top right): first person, Minecraft controls (click to capture the mouse, WASD, Space jumps, Shift runs, Esc releases; touch: circular joystick on the left thumb + drag on the right to look, jump button). Look-only: you stay in front of the wall and can't pass its ends. Three.js loaded on demand; wall = 3 canvas-textured segments, one sun shadow that follows you, instanced trees, a lost blocky visitor with a question mark, a conversation with him when you get close (question bubble with 4 answers, then a window with the original team and sources; members and answers live at the top of `public/viewer3d.js`), and an original happy tune synthesized live with Web Audio (no audio files, so no licensing; mute button remembers your choice)
- Credits button with the original piche.me creators and references
- Recent walls modal, live polling
- Whitelisted fonts/colors, 140-char limit, per-IP rate limit
- **Scribbles that fade.** Anonymous scribbles last 7 days and grow fainter as time runs out, then vanish. Anyone can tap one and press "♥ apoiar" to add a day (once per person, up to 30 days total). Signing a scribble ("Assinar como…") makes it permanent. The first browser to use a name owns it (a random secret kept in that browser, stored only as a hash). Scribbles made before this rule existed are permanent. Tunable with `ANON_TTL_MS` and `SUPPORT_BONUS_MS`. Trade-off: with no accounts, clearing browser data loses the right to your signature.

- **Places and map.** When creating a wall you can optionally tie it to a place ("📍 Usar minha localização" + a place name). The browser only asks for location when you click. Coordinates are rounded to 2 decimals (~1 km) before being sent/stored, so a wall names a neighbourhood, never an address; the place is fixed at creation like the look. The "mapa" button shows walls that have a place on an OpenStreetMap map (Leaflet is served from our own server; only the tile images come from `tile.openstreetmap.org`, allowed in the CSP). The place name is shown in the top bar and in the 3D view. Not used: Google Street View imagery (licence). Note the public OSM tile server is for light use; switch to a tile provider if traffic grows.

- **Photo of the place (Mapillary).** Optional, only when `MAPILLARY_TOKEN` is set (free client token from mapillary.com/dashboard/developers). When creating a wall with a place, a checkbox uses an open street-level photo near that place as the wall surface (2D and 3D). The server fetches one photo once, at creation, and stores it under `DATA_DIR/photos/`, so visitors never contact Mapillary and the image never changes. Only https URLs on Mapillary hosts are followed, JPEG only, max 3 MB. The credit ("Foto: autor (ano) / Mapillary, CC BY-SA 4.0") is shown on screen; Mapillary blurs faces and plates itself. If there is no photo nearby or the API fails, the wall is created anyway with the chosen texture and a note. Tests use a fake upstream (`MAPILLARY_API`, `MAPILLARY_HOSTS`); the real API is not exercised.
- **Modo clássico.** The "clássico/moderno" button in the top bar switches the page chrome (header, buttons, compose bar, dialogs) to a flat early-2010s look. Remembered in the browser; the wall and scribbles are unchanged. It is an homage in spirit, not a pixel copy of the original site.

- **Street scene from OpenStreetMap.** OSM has no photos, so instead of a camera image the 3D view can rebuild the neighbourhood: when creating a wall with a place, tick "Montar o cenário do lugar no 3D". The server asks the Overpass API once (about 220 m around the place, up to 500 buildings and 200 roads), stores a small JSON under `DATA_DIR/scenes/`, and the 3D view draws roads as flat strips and buildings as extruded footprints (heights from `height` / `building:levels`, else a guess) in two merged meshes. Anything overlapping the wall and its walkway is left out, so the wall stands in a clearing. The map is placed on the far side of the walkway (turned 180° if its busier half would otherwise be hidden behind the wall), and the "Ver a rua / Ver o muro" button in the 3D view turns you around between the wall and the street. The place is rounded to ~1 km for privacy, so the scene is "that region", not an exact address. Data © OpenStreetMap contributors (ODbL), credited in the 3D view. Override the endpoint with `OVERPASS_API`; the public Overpass server is for light use. Walls with a place but no scene (made earlier) fetch theirs on first 3D open. Walls with no place get a generic town street (procedural), so every wall's 3D view has a street, with window facades, sidewalks, asphalt and a dashed centre line. Tests use a fake Overpass.

## Not implemented (yet)

Accounts, chat, the 2013 redesign, moderation tools, a real database.

## Tests

`npm test` runs the API/security suite (48 checks) and two browser suites (creation popup, wide wall, rotation, size, 3D, CSP; board positions, dragging, zoom, phone touch). They start their own server on a free port with a temporary data folder. Browser suites need Chrome (`CHROME_BIN=/path/to/chrome`). `npm run test:api` needs no browser.

The page template lives in `src/app.template.html` (not in `public/index.html`).
