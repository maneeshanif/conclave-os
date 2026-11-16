# JSM-HQ office — own-words reference

Date: 2026-11-15
Source: `/c/Users/HP/.conclave-os/reference/jsm-hq` (MIT, code-drawn, PixiJS 8).
Rule: reference only — not imported as code into Conclave. All our art = Kenney CC0 or drawn here (SPEC 12).

## Tech stack (read from source)

- **Renderer**: PixiJS 8 (`pixi.js ^8.22.0`). Single `Application` owned by `OfficeScene`.
- **Two drawing backends** (`src/office/engine/pen.ts`):
  - `CanvasPen` wraps a `CanvasRenderingContext2D` for the **static layer** (lawn, floors, walls, furniture, signs) and for sprite canvases.
  - `GfxPen` wraps a Pixi `Graphics` for the **live layer** (monitors, belt, cables, bots' eyes/emotes/tags each frame).
- **Sprite creation** (`src/office/engine/pen.ts` + `textures.ts`):
  - `spriteCanvas(rows, palette)` builds a 1-bit canvas from ASCII-art rows + a char→color map.
  - `canvasTexture(canvas)` wraps a canvas in a nearest-neighbour Pixi `Texture` via `CanvasSource`.
  - `flipCanvas` for mirrored side sprites.
- **Font**: a 3×5 bitmap font in `src/office/engine/font.ts` (`FONT` record, `text()`, `tag()`, `fit()`). In-world signs and name tags are drawn, not a web font.
- **Characters**: **no image files**. Robots are generated from ASCII-art sprite rows in `src/office/draw/robots.ts` (`robotCanvases(color, lead)` → `front/back/type/side/sideL`), recoloured per agent via a palette map `k/B/b/h/V/G`. Lead gets a crown row; others get an antenna row. A rabbit/scanner ASCII sprite is used for the review gate (`RABBIT`, `SCANNER`).
- **Layout**: pure code generation in `src/office/layout/layout.ts` (`generateLayout(config, envs)`). Tile grid `TS = 16`, `WalkGrid` (BFS 4-way) in `src/office/engine/path.ts`. Desks, lead corner, lounge, PR belt, gate, PR board, server room + racks are all positioned from team size + workflow config. `layoutKey()` invalidates the static layer when config changes.
- **Walking**: `Bot` in `src/office/actors/bots.ts` carries a `path: Tile[]`, moves at `SPEED = 52 px/s` toward the next tile centre, picks facing from movement direction, hovers (bob) while idle/moving.
- **Animation split**:
  - Slow layer (~8 fps) draws monitors, PR board, racks, window/clock; `drawSlow()`.
  - Fast layer every frame: plan title, cables, desk strips, belt, parcels, gate, bot shadows/faces/emotes/tags; `drawFast()`.
- **Input**: `src/office/sceneInput.ts` — pointer drag to pan, wheel to zoom (integer steps), hover + click hit-testing against agent rects + `layout.hits`. Clicking an agent opens its drawer; clicking the plan wall / gate / PR board / environment rack opens the matching panel.
- **UI side (React)**: the office canvas is `<div class="fixed inset-0">` from `src/office/OfficeCanvas.tsx`. Drawers flank the world: `ActionItemsDrawer`, `AgentDrawer`, `BoardsDrawer`, `EnvironmentDrawer`, `Ports`, `PrDrawer`, `TerminalDrawer`. Top bar: `TopBar`, `ActivityFeed`, `ConnectionBanner`, `TeamPanel`, `Tooltip`. Settings: `BoardsSettings`, `McpSettings`, `controls`.

## Layout anatomy (own words)

- Outdoor: lawn (grass) with scattered flowers, trees, a path from a left-side door to the building, shadow on building right/bottom.
- Building: wood floor main area, tile floor in the lounge, grate floor in the server room. Top wall band, main wall, base, door on the left wall, glass wall + "SERVER ROOM" label when deploy is on.
- Back wall: plan board (white cork board with TODO/DOING/REVIEW/DONE headers), office name sign, "SHIP" light, water cooler, arcade cabinet, fridge/counter, couch, stand-up rug, beanbags.
- Lead corner: lead desk + two screens + a lamp that reflects status, shelves of colored blocks, plant.
- Desks: cubicle partitions (two side panels + top, door gap at tile 1), each desk has a monitor (with live screen content), keyboard tray, mug/plant/duck prop, a desk carpet, and a name plate. A status light strip runs along the top partition per desk.
- Review column (when enabled): PR belt (horizontal, with a vertical run up to the gate when there's a server room), review gate with a scanner/rabbit eye, a PR board (easel), server room with racks (each labelled, with activity lights + green pulse on deploy/merge).
- Parcels: PRs become parcels on the belt; colour-tagged `#N`, fly between desk and belt/gate, scan at the gate, fly home on changes-requested, fly to "main" + burst on merge.

## Character art approach (the key bit for our office)

- **Characters are generated, not asset files.** Each agent = a small hover-robot built from ASCII-art sprite rows, recoloured by a per-agent color. That means:
  - No sprite sheet to license-keep.
  - Recolouring is cheap: one `robotCanvases(color, lead)` per distinct color+lead combo, cached.
  - The robot body is ~11 rows × ~12 cols; the head (antenna or crown) is 3 rows.
- **State is shown by screen content + eyes + emotes + name tag + desk strip**, not by swapping avatar images:
  - Monitor: idle (small colour block drifting), working (scrolling code lines + blinking cursor), needs-input (red), in-review (orange bars), review-passed (green check).
  - Eyes: coloured by state, blink on a schedule; glance indicator when pathing.
  - Emotes: speech bubbles with `dots/wait/check/bang/talk/mail/ok/coffee/zz`.
  - Name tag: bitmap text on a plate above the bot.
  - Desk strip: a status-coloured light along the cubicle top.
- **Recolouring strategy is reusable**: a char→color palette + ASCII rows → canvas → nearest-neighbour texture. We can adopt exactly this technique (it's our own code here, not a copy of jsm-hq assets) and feed it our own ASCII art.

## What to steal (our own code here, in our own words)

These are **techniques** we can reimplement for Conclave's office, not assets:

1. Two-layer drawing: static canvas (built once per layout) + per-frame Pixi Graphics for live bits.
2. ASCII-art → canvas → nearest-neighbour Pixi texture for characters + small props.
3. A 3×5 bitmap font for in-world text (signs, name tags, parcel tags).
4. Code-generated layout from team/workflow config (so the office resizes to the team, not a fixed map).
5. BFS walk grid on a tile grid; bots path to seats and errands.
6. Status shown via monitor content + eyes + emotes + name tag + desk strip, not avatar swapping.
7. Hit-testing on agent rects + named zones, with pointer drag-pan + integer-step zoom, and click-to-open-drawer.
8. Drawers that flank the world; top bar with activity feed + team panel; tooltips.

## What NOT to copy (license)

- Do not copy jsm-hq source files, the robot ASCII rows, palette values, layout constants, or any other code into Conclave. Use the **ideas**, write our own code.
- Do not treat jsm-hq as a drop-in office; it's a different product (HQ/agent terminals). We are borrowing the *look + technique*, not the feature set.
- WorkAdventure is AGPL v3 + Commons Clause: read-only look, no sprites/code/textures/maps. Notes + screenshots only, in our own words.

## Gap vs Conclave's current `/office`

Conclave today: Phaser canvas + Tiled map reader (SPEC 12: Phaser+Tiled, Kenney CC0). Panels are plain React (OfficeBar / OfficeView) with a list under the map.

Opportunities, in priority order (to confirm with the user / per BUILD.md S6):

1. First: make the office *feel* like a place — outdoorground, a building, desks, a plan wall, status lights — even if still Phaser/Tiled. Kenney CC0 art for props.
2. Add character 상태 visibility where it's missing: a light/status on each desk, an in-world name tag, a simple status indicator on the avatar (eyes/ colour/ emote bubble) rather than only a list.
3. Add pointer pan + zoom on the map/canvas if absent; click a desk/agent to open the agent drawer (Conclave already has drawer concept per BUILD? verify).
4. Add a plan wall / task board zone that feels like a board, not a list (sticky-note style) — our own drawn art.
5. If the user wants the jsm-hq *pixel-robot* look specifically: implement our own ASCII-art → canvas → texture character renderer with our own robot art (not jsm-hq's rows), recoloured per agent. That keeps us Kenney-or-drawn (SPEC 12) and out of AGPL.

## Prompts/ideas for "my own images" (after the look pass)

- Next step after jsm-hq look pass + WorkAdventure look pass: write a small set of image prompts for our own office art (floor, desk, monitor screen, plan board, robot/avatar sprite sheets in our own style), generated by a Gen-AI image flow (the "google flow mcp server" the user mentioned — needs verification before wiring). Keep everything CC0 / owned by us; never prompt-for + reuse WorkAdventure sprites.
- Likely candidate flow: OpenAI DALL-E / GPT Image, or an image-gen MCP server the user already has. Confirm which one before integrating.
