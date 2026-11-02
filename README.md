# repiche.me

Draft clone of [piche.me](https://deriva-telar.fau.usp.br/piche-me/), the Brazilian social network (2011-2015) where anyone could "pichar" a virtual wall, no login needed.

Stack: Node.js + Express (API, JSON file storage) and Vue 3 (served locally, no build step).

## Run

```sh
npm install
npm start
```

Open http://localhost:3000. Any path is a wall: `/meunome` creates one on first visit.

## Features

- Anonymous walls by URL, scribbles with chosen font, color, size and weight
- Random but persistent position/rotation per scribble
- 6 CSS-only wall backgrounds
- Recent walls modal, live polling, pagination of older scribbles
- Whitelisted fonts/colors, 140-char limit, per-IP rate limit

## Not implemented (yet)

Accounts, chat, the 2013 redesign, moderation tools, a real database.
