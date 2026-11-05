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

## Not implemented (yet)

Accounts, chat, the 2013 redesign, moderation tools, a real database.

## Tests

`npm test` runs the API/security suite (48 checks) and two browser suites (creation popup, wide wall, rotation, size, 3D, CSP; board positions, dragging, zoom, phone touch). They start their own server on a free port with a temporary data folder. Browser suites need Chrome (`CHROME_BIN=/path/to/chrome`). `npm run test:api` needs no browser.

The page template lives in `src/app.template.html` (not in `public/index.html`).
