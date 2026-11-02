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
- Random but persistent position/rotation per scribble
- Textured wall backgrounds: 9 presets, or any color + one of 8 textures (brick, concrete, wood, paper, grunge, tiles, metal, plain), drawn with CSS/SVG (no image files)
- Zoom: in capped at 300%, out unlimited (floor 0.1%). +/- buttons, Ctrl/Cmd+wheel or trackpad pinch, two-finger pinch on phones. Zooming out auto-loads older scribbles
- Credits button with the original piche.me creators and references
- Recent walls modal, live polling, pagination of older scribbles
- Whitelisted fonts/colors, 140-char limit, per-IP rate limit

## Not implemented (yet)

Accounts, chat, the 2013 redesign, moderation tools, a real database.
