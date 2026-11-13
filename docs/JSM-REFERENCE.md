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
