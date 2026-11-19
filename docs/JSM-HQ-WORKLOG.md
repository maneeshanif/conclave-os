# JSM-HQ office look reference — worklog

Date: 2026-11-15
Status: started — clone on disk, surface scan in progress.

Goal: drive a Playwright pass over jsm-hq, capture the office look (layout, drawers,
2D canvas tooling, character art approach), then write own-words notes + prompts here.
Then do the same for WorkAdventure (public demo, guest only, screenshots in `.reference/`,
no asset/code copy — AGPL + Commons Clause).

Clones:
- jsm-hq: `/c/Users/HP/.conclave-os/reference/jsm-hq` (MIT, code-drawn PixiJS 8)
- workadventure: `/c/Users/HP/.conclave-os/reference/workadventure` (AGPL v3 + Commons Clause
  — read-only look, NO copying sprites/code/textures)

Rules (never break):
- No WorkAdventure sprite, texture, sound, map tile, or code into Conclave. Notes + screenshots
  only, written in our own words.
- jsm-hq is outside the repo; reference only, not imported as code.
- All Conclave art = Kenney CC0 or drawn here (SPEC 12).

Current factual gap on "(B), 1": user wants jsm-hq "code first" then a WorkAdventure clone
used for "images and all worlds" then "more prompt from that images" then a "google flow mcp
server" to "create my own ones." I will interpret this as: do the jsm-hq look pass first,
then the WorkAdventure look pass, then write image/prompt ideas, then pursue a tool-assisted
image generation path — but the WorkAdventure "use images" instruction cannot mean re-use of
WA assets (license). I will treat it as "study the worlds, then generate our own."

Next concrete steps:
1. Inspect jsm-hq's office entry point + PixiJS 8 setup; note the 2D canvas tooling used.
2. Open jsm-hq office in Playwright (serve locally if possible), screenshot the office,
   record the layout/drawers/character rendering approach.
3. Write jsm-hq own-words notes into `docs/JSM-REFERENCE.md` (extend existing).
4. Then WorkAdventure: use public demo via Playwright (guest), screenshot office, write
   own-words notes into `docs/WORLD-REFERENCE.md`, save screenshots into `.reference/` (git-ignored).
5. Write image/prompt ideas here (no WA assets).
6. Clarify "google flow mcp server" — likely a Gen AI image flow; verify before wiring anything.
