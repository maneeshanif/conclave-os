# OpenPuff CLI / Playwright note

Created 2026-11-15 by Buffy for this review-and-UI pass.

## What "OpenPuff CLI" refers to here

On this machine there is **no** `openpuff`, `openpuff-cli` or `opuff` binary on PATH (checked `which`). There is also no `.agents/` folder or skillsinstalled yet (checked `.agents/`). So "OpenPuff CLI" is not a tool already present on the machine.

What *is* present and usable:

- **playwright-core** is already a dependency of both `apps/server` and `apps/web` (version 1.65.0). The repo's own e2e uses it directly:
  - `apps/web/e2e/office.e2e.ts` — builds the web app, serves it on loopback, opens Chromium, checks the canvas is not blank, checks the plain list, saves screenshots to `e2e-output/`. Uses `playwright-core` (chromium).
  - `apps/web/e2e/mobile.e2e.ts` — same idea for the mobile profile.
  - These are the "Playwright" tools for this repo. They are already wired; nothing external to install to drive a browser here.
- **Internet access**: yes. The machine can reach the package registry (I pulled `npx skills` just now) and can run `web_search` / `read_url` via the tools.

## What "start the Playwright MCP server" would mean here

There is no Playwright MCP server running or installed yet on this machine. The repo accesses Playwright through `playwright-core` in the e2e tests, not through an MCP server. If you want an actual MCP server that I can talk to *instead* of running the e2e tests myself, that is a separate install and needs a host to run it in (for example the Claude Code MCP setup, or a running Playwright MCP process). I have not set one up, and I would not copy any WorkAdventure or jsm-hq assets through it.

## The hard limit (re-stated, from WORLD-BRIEF.md and CLAUDE.md)

- WorkAdventure is AGPL v3 + Commons Clause. We may **not** copy or download its code, tiles, sprites, maps, icons, fonts, sounds, or text into this repo or the app. Screenshots are reference only, kept in `.reference/` (git-ignored), and written about in our own words in `docs/WORLD-REFERENCE.md`.
- jsm-hq is MIT licensed per the DECISIONS entry, **but** it still lives outside this repo at `DATA_DIR/reference/jsm-hq`, and **no code, art, or text from it is in this repo**. We read it for ideas only.
- Our own art is Kenney (CC0) or drawn here. Our property names are our own.
- The Playwright MCP server (real or this note's "OpenPuff CLI") is only a browser-driving tool. It does not change the above rules. I will not use it to extract or reuse WorkAdventure or jsm-hq assets.

## Where the world clones live (confirmed)

- Default `DATA_DIR` on this machine: `~/.conclave-os` = `/c/Users/HP/.conclave-os`.
- That folder has a `reference/` subfolder (`/c/Users/HP/.conclave-os/reference`) — this is where WORLD-BRIEF.md and WORLD-REFERENCE.md say the WorkAdventure + jsm-hq reference material lives, **outside the repo**.
- This repo (`C:/code/conclave-os-starter`) contains **no** WorkAdventure or jsm-hq code, art, or text.

## Plan for this pass (before touching the office UI)

1. Document this note (done — this file).
2. Confirm where the WorkAdventure and jsm-hq clones actually are on this machine (inside or beside `~/.conclave-os/reference/`), and read only what the spec allows (ideas + screenshots, never copy assets/code into this repo).
3. Use the repo's own Playwright setup (the e2e, or a small Playwright-core script) to screenshot the current `/office` and the reference worlds, and write what I see into `docs/WORLD-REFERENCE.md` in my own words.
4. Touch the office UI only per what is in `docs/BUILD.md` and `docs/SPEC.md` for S6, and only after writing a change log so you can track what I changed.
