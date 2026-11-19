# JSM HQ: how its office looks and works, and the gaps against our /office

Written 2026-11-14 for S6-14a, in my own words. The repo is `jsmastery-pro/jsm-hq` (JavaScript Mastery's organisation; version 0.7.5, last commit 2026-11-09). It is **MIT licensed** (see the DECISIONS entry of the same date). I read its source from a clone kept **outside** this repo (`DATA_DIR/reference/jsm-hq`) and ran its built-in demo (`pnpm dev`, fake data, nothing leaves the browser) on loopback as a guest, installing with scripts switched off. The screenshots are in `.reference/` (git-ignored). **No code, art or text from it is in this repo.**

## What it is

A tool for running a team of AI coding agents on a git repo (a lead plans and hands out tasks, workers build in sandboxes and open pull requests) with a **pixel-art office you watch**. It is a spectator view: there is no avatar for you. You pan, zoom, hover and click.

## The library and how it is wired

- **PixiJS 8** draws the office (`pixi.js`). **Not Phaser.** React 18 with Tailwind and Zustand draws everything around it (top bar, team list, activity feed, drawers, settings).
- All the art is **drawn in code**: small functions paint furniture, desks, robots (the agents are little robots), a conveyor belt for pull requests and so on onto textures. There are no map files and no image assets (the only images are two screenshots for the README).
- The data comes through one interface with two sources: a **mock** source (a simulation with presets, a speed control of 1x, 2x, 4x) for the demo, and a **WebSocket** source for the real server. The stores are the only code that talks to it. The canvas reads a snapshot and draws it.
- The scene (`OfficeScene`) owns a camera, the layout, the bots (agents) and effects. Input is a small file: pointer down and move pans, a wheel zooms in whole steps, a hover shows a tooltip, a click on a thing opens its drawer.

## The layout

- **Generated from the team**, not drawn by hand: a function turns "the team plus the workflow settings" into a grid of 16 px tiles: a lead's corner on the top left, a lounge beside it (coffee counter, couch, table, water cooler, an arcade cabinet), a corridor, then a grid of **cubicles** (7 by 7 tiles, one per worker, up to five across), a **pull-request belt** along the bottom with a review gate on it, a PR board, and on the right an optional **server room** behind glass with one rack per environment. The building grows as agents are added. The plan wall (a kanban strip), a sign, a clock, a window and a bookshelf are on the back wall. Outside: grass and trees.
- A **walk grid** marks which tiles can be stood on, so the robots can wander to the lounge, walk to the plan wall, carry a parcel to the belt and so on. Agents have a desk (seat tile and a drop tile for parcels).
- Each clickable thing is a **hit** (a rectangle with a kind and an id): an agent, the plan wall, the review gate, the PR board, a rack.

## What you can do, part by part

- **Top bar** (one cream bar with chunky pixel buttons): logo and a "demo data" badge; a **board picker** (which board shows on the plan wall); speed 1x, 2x, 4x and zoom out and in (demo only for speed); a **Sandbox status** pill; **Action items** (everything waiting on you, with a count); **Boards**; **PRs** (with a count); **Terminal**; **Settings**; **Debug**.
- **Team panel** (left, over the map): one card per agent with its small portrait, name, role and tool, a state chip (working, in review, needs input), how long, and chips such as "1 for you" and "3 blocked"; the line under it is its current task or a question it is asking. A red outline marks one that needs you. "+ Agent" adds one.
- **Activity feed** (bottom left): a short live list with an icon per kind (started a task, a message between agents, an assignment, a PR opened, "you answered").
- **Hover** over an agent, the plan wall, the PR board, the gate or a rack: a tooltip with a title and a line (state and task, number of boards, open PRs, an environment's URL).
- **Click an agent** (in the world or on its card): a **drawer on the right**: name and state, a "session running" strip with its folder and a Stop button, its current line, then tabs **Terminal** (the live terminal of the agent), **Shell**, **Task**, **Sandbox**, **Messages**. The drawer can be dragged wider, maximised, closed. The world shifts and stays visible beside it.
- **Click the plan wall or the Boards button:** a large **modal** with the phases as tabs, a status control (agents only pick tasks from active boards) and a kanban of To do, Doing, Review, Done with each task card and an assign control.
- **Click the review gate or PR board or the PRs button:** the right drawer with open and merged pull requests, each with its author, age, review state and an "open on GitHub" button.
- **Click a rack:** an environment drawer. **Action items** and **Terminal** are drawers too (the terminal is your own shell with a folder picker).
- **Settings** is a big modal with a side menu (Team, Workflow, Stack, MCP, Sandbox, Boards, Project). **Team** lists each agent (name, role, tool, where it runs, More, Remove) and has an inline "add an agent" form. Changes apply at once.
- **Zoom** goes in whole steps; zoomed right in you see the lead at their desk with a name plate and the pixel detail. **Drag** pans.
- **Phone:** there is none. At phone width the top bar runs off the screen and the office is not shown; it is a desktop tool.

## What I take from it (ideas, written fresh)

1. A **generated layout**: the office grows from the team instead of being drawn by hand. Our rooms come from departments, so a new department should get a room automatically (this is S6-13b).
2. **Everything clickable is a "hit" with a kind and an id** and one function maps a kind to what opens. Ours is the object registry; the same idea.
3. **Drawers beside the world, not over it**, with a maximise button and a width you can drag. Our panels (S6-12a) should keep the world visible beside them on a desktop.
4. **Hover tooltips** on every thing: name, state, one line.
5. **A team list beside the map** with state chips and "for you" counts, and a short **activity feed**: both are a quick way to see what needs you without walking anywhere. Our plain list and People panel are the start of this.
6. **Work shown as movement**: parcels carried to the belt, agents walking to the wall. This matches the handoff idea in S6-13d.
7. **A calm, consistent pixel look** with chunky outlined buttons and a cream and ink palette, drawn in code so there is nothing to license.

## Gaps against our /office (now)

| Part | JSM HQ | Ours | Gap to close |
| --- | --- | --- | --- |
| You in the world | No avatar: spectator | You walk, with presence for others | None; ours goes further |
| Where everything opens | Drawers beside the map, modal for boards and settings | A panel is not built yet (S6-12) | Panels beside the world with maximise and resizable width |
| Hover | Tooltip on every thing | None | Tooltips for agents, objects, rooms |
| Team list | Left cards with state and "for you" | A People panel; a plain list below | Cards with state chips and counts in the panel |
| Activity | A live feed | None | A short feed from the bus (runs, approvals, tasks) |
| Layout | Generated from the team | Hand-made map | Rooms stamped for new departments (S6-13b) |
| Work as movement | Parcels, agents walk to the wall | Agents move between desk, lounge, approvals desk | Handoffs shown as walking (S6-13d) |
| Add agent | Inline form in settings | Not yet | From the world, behind approve (S6-13c) |
| Many companies | One project | One company | Company switcher (S6-13a) |
| Phone | None | A small map and the list | Already ahead; keep it |
| Looks | Cream and ink, outlined buttons | Dark floating bar, flat tiles and sprites | Pass 2 (S6-15) decides the final look |


---

## Addendum, 2026-11-15: the second reading (by the other CLI)

The notes below are a second, shorter reading of the same clone. Where they differ from the sections above, the sections above were checked against the running demo.


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
