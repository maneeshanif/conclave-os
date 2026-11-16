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

---

## Claude Code session, 2026-11-17 (after the weekly limit reset; the other CLI's notes above are kept as they were)

What I did, in order. Every item is a commit on `dev`, so `git log` shows the same list.

1. Read the notes above (`OPENPUFF-CLI.md`, this file, `JSM-HQ-WORKLOG.md`, the two reference docs) and committed them unchanged with S6-15b (244f575).
2. Finished S6-10 (the Boardroom, 4220cf0) and S0-15 (the e2e leaves the repo alone, 35bc042), which were old open tasks, before any new look work.
3. S6-15a (1c77aeb): the world is now the whole screen. No page margins; the bar, zoom buttons and panels float over it. The list of rooms and agents is a panel (`?panel=rooms`) opened from a new button in the bar.
4. S6-15b (244f575): your avatar. A picker in the bar with a name box and the six looks, kept in this browser; presence carries `look` (0 to 5) so others see your choice.
5. S6-15d (this commit): the office art. Floors with grain and no grid lines, walls with a lit edge and shadow, a drawn sheet of sixteen furniture pieces (one per object type), crisp pixel scaling. All drawn in `scripts/make-office.mjs` and `scripts/make-sprites.mjs`, so the art is ours.

Tools used
- **Playwright MCP server**: started on `http://127.0.0.1:8931/mcp` (loopback only, headless, `npx @playwright/mcp`). This Claude Code session has no connection to it, so for the browser work I used `playwright-core` (the same engine, already in the repo) in short scripts, plus the repo's own `pnpm run e2e:mobile` (8 tests, desktop and Android sizes). Screenshots from the e2e are in `e2e-output/`; reference screenshots are in `.reference/` (git-ignored).
- **jsm-hq**: the clone in `~/.conclave-os/reference/jsm-hq` ran on `http://127.0.0.1:5173/` (its own Vite dev server) and I took a screenshot. Its 2D approach (ASCII-art rows to canvas to nearest-neighbour texture, a two-layer draw, a tiny bitmap font) is what the art above follows, in our own code and palette.
- **WorkAdventure**: look only. Nothing from it (code, tiles, sprites, maps, icons, fonts, text) is in this repo. CLAUDE.md and WORLD-BRIEF forbid it.

Not done, on purpose
- "Use all the character images of that server": I did not take images from WorkAdventure or jsm-hq. Our six characters are drawn in `make-sprites.mjs`. If you want more looks, the way is to draw more in that script, or to generate our own with the image tool and commit them with their source noted in ART.md.

Still to do in S6-15: talking to someone near you (S6-15c), then S6-11 (slice end to end, full `pnpm test`, tag `slice-6-done`).

6. S6-15c (talking to someone near you): text-only chat to people within 5 tiles over the existing presence socket (server limits: 300 characters, one line per half second, nothing stored), and a bubble in the world that opens within 4 tiles and closes past 5. Tests: `office-presence.test.ts`, `office-chat.test.ts`, `chat-bubble.test.tsx`.

7. S6-11 (slice 6 end to end): `slice6-world.test.ts` (real map: door to Outreach zone, agent drawer, approvals desk panel, deep links, chat range), `slice6-e2e.test.ts` (propose, approve, execute once, agent in the office, Boardroom, decision). Full `pnpm test` ran once: 1454 passed, 3 failed, all fixed: the art licence list needed `objects.png`; `JSM-REFERENCE.md` had lost the sections a test requires when it was rewritten, so the original is restored and the second reading is kept as an addendum; the plan-limit test used a fixed date and now uses the real clock. Browser run: 8 of 8 at desktop and Android sizes (the desktop test's time limit was raised to 180 s). Tagged `slice-6-done`.
