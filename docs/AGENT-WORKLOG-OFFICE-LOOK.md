# Agent worklog — office look pass (jsm-hq first, then WorkAdventure)

Date: 2026-11-15
Author: Buffy (Freebuff session)

What I did this session
- Read the user's instruction: "(B), 1" — i.e. do jsm-hq "code first", then clone the second repo (WorkAdventure), use its images/worlds, then make more prompts from those images, then use a "google flow mcp server" to create our own ones.
- Re-checked the environment:
  - No OpenPuff CLI binary anywhere on PATH; no `.agents/` folder; no Playwright MCP server installed. Playwright is available to this repo via `playwright-core` in `apps/server` + `apps/web` (1.65.0) and the existing e2e tests.
  - jsm-hq clone already on disk at `/c/Users/HP/.conclave-os/reference/jsm-hq`.
  - Cloned WorkAdventure to `/c/Users/HP/.conclave-os/reference/workadventure` (shallow).
- Read jsm-hq source, office subsystem, end to end:
  - Stack: React 18 + Vite + PixiJS 8 (`pixi.js ^8.22.0`), Tailwind v4, Zustand, framer-motion, xterm, MCP SDK.
  - Renderer lives in `src/office/OfficeScene.ts` (a single Pixi Application). Two backends in `src/office/engine/pen.ts`: `CanvasPen` (2D canvas, for the static layer + sprite canvases) and `GfxPen` (Pixi Graphics, for per-frame live layer).
  - Sprites are generated, not files: `src/office/draw/robots.ts` builds hover-robot canvases from ASCII-art rows + a char→color palette, per agent color (+ crown for lead). `src/office/engine/textures.ts` wraps canvases in nearest-neighbour Pixi textures.
  - Font: a 3×5 bitmap font in `src/office/engine/font.ts` for signs/tags/parcel numbers.
  - Layout is code-generated in `src/office/layout/layout.ts` from team+workflow config (`generateLayout`), on a `TS = 16` tile grid with a BFS `WalkGrid` in `src/office/engine/path.ts`.
  - Bots walk in `src/office/actors/bots.ts`; parcels (PRs) run on a belt + gate in `src/office/actors/parcels.ts`; sticky notes on the plan wall in `src/office/actors/planNotes.ts`; effects (envelopes/float text/burst) in `src/office/actors/effects.ts`.
  - Live drawing in `src/office/draw/live.ts` (monitors, desk strips, belt, gate, racks, PR board, cables, window/clock, parcels); overlays in `src/office/draw/overlay.ts` (shadow, face/eyes, emotes, name tags, selection); static furniture/decor in `src/office/draw/static.ts` + `furniture.ts`.
  - Input: `src/office/sceneInput.ts` (pointer drag-pan, integer-step wheel zoom, hover + click hit-testing on agents + named zones, click-to-open-drawer).
  - React side: `src/office/OfficeCanvas.tsx` mounts the scene into a `fixed inset-0` div; drawers + top bar + tooltips in `src/ui/drawers/` and `src/ui/hud/`.
- Extended `docs/JSM-REFERENCE.md` with own-words notes: tech stack, two-layer drawing, ASCII→canvas→texture character technique, bitmap font, code-generated layout, bot walking, status-via-monitor/eyes/emotes/tag/strip, input model, layout anatomy, what to reuse as techniques vs what not to copy, and a gap table vs Conclave's current `/office`.
- Wrote `docs/JSM-HQ-WORKLOG.md` to track the jsm-hq-first plan + hard limits.
- Confirmed license facts:
  - jsm-hq = MIT (code reference only, not imported).
  - WorkAdventure = AGPL v3 + Commons Clause (README explicitly advertises a hosted/paid SaaS; LICENSE file is the binding check, still to be opened). For Conclave: read-only look, no sprites/code/textures/maps. Notes + screenshots only, in our own words.

Facts still unknown / next
- The actual WorkAdventure LICENSE file contents (I read the README, which is enough to flag the risk, but the binding license file is the next check). Note: the repo's own AGENTS.md + CLAUDE.md are dev-guide files, not a license.
- Whether WorkAdventure has image/sprite assets inside the repo (early scan shows `maps/`, `maps/assets/`, `play/public/static/images`, `play/public/resources/icons`, docs images). I will inventory only enough to know what not to touch, not to reuse.
- What the user means by "google flow mcp server" — likely an image-generation flow (DALL-E / GPT image / an image-gen MCP server). I will not wire it until confirmed.
- Whether Conclave's current office already has pointer pan/zoom, in-world name tags, desk status lights, and a drawer system — I need to re-read the actual office code before proposing concrete diffs, per the user's "code first" instruction.

Interpretation I'm operating under (to confirm with the user)
- "(B), 1" = do the jsm-hq look/technique pass first (done reading; next = a browser look pass + screenshots, then notes), then clone/pull the WorkAdventure repo (done-ish: shallow clone on disk) and study its worlds/images (read-only, no reuse), then write more prompts for our own images, then use an image-gen flow (the "google flow mcp server") to generate our own assets. The phrase "use that images and all worlds" is treated as *study*, not *reuse*, because WorkAdventure is AGPL + Commons Clause and Conclave's own rule (SPEC 12 / CLAUDE.md) forbids copying WorkAdventure assets/code.
- The jsm-hq "code first" is treated as: understand the code/drawing technique now, then mirror the *ideas* in our own code later (our own ASCII art, our own palette, our own layout), not copy jsm-hq files.

Files written/updated this session
- `docs/OPENPUFF-CLI.md` (earlier session)
- `docs/JSM-HQ-WORKLOG.md` (new)
- `docs/JSM-REFERENCE.md` (extended)

Next concrete actions (pending user OK)
1. Open WorkAdventure's LICENSE file to confirm the binding terms, then write the look-only rule clearly.
2. Inventory WorkAdventure image/sprite/map assets just enough to know the "do not touch" set (no reuse).
3. Do the jsm-hq browser look pass with Playwright (serve jsm-hq locally if it builds, or use its demo; screenshot the office; save into `.reference/` git-ignored). Note: jsm-hq needs Node 20+, Docker Sandboxes for real agents, but the UI demo may run without agents — verify.
4. Do the WorkAdventure public-demo look pass via Playwright (guest, no login), screenshot the office, save into `.reference/`, write own-words notes to `docs/WORLD-REFERENCE.md`.
5. Write a small image-prompt list for our own office art (our own style), then confirm which image-gen flow ("google flow mcp server") to use before wiring anything.
6. Only after the look pass + user OK: make concrete, small office UI changes in Conclave per BUILD.md S6, in our own code, Kenney CC0 or drawn here.

Still blocked until the user answers
- Exact meaning of "use that images and all worlds" — I am proceeding on the study-only interpretation, but I should confirm I am not crossing the line the user intended.
- Which image-gen "google flow mcp server" to use — confirm before any integration.
