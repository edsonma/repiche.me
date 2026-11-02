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
- Scribbles are permanent: text and position cannot be edited or moved once fixed (the API has no edit/delete routes)
- 2D wall: after "Pichar" drag the scribble anywhere, then "Fixar aqui". Position is saved and identical on every reload and for every visitor
- Wide wall: the board is 2400px wide (constant `WALL_W` in `public/app.js`), scroll sideways inside it; starts centered
- Creating a wall: opening an unused name with no scribbles shows "Crie seu muro" (name + color/texture). Nothing is stored until "Criar muro"
- Textured wall backgrounds (chosen once at creation, locked afterwards): 9 presets, or any color + one of 8 textures (brick, concrete, wood, paper, grunge, tiles, metal, plain), drawn with CSS/SVG (no image files)
- Zoom: in capped at 300%, out unlimited (floor 0.1%). +/- buttons, Ctrl/Cmd+wheel or trackpad pinch, two-finger pinch on phones.
- Credits button with the original piche.me creators and references
- Recent walls modal, live polling
- Whitelisted fonts/colors, 140-char limit, per-IP rate limit

## Not implemented (yet)

Accounts, chat, the 2013 redesign, moderation tools, a real database.
