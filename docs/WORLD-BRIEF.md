# The world: make /office feel like WorkAdventure

From Anees, 2026-11-14. **Priority one for slice 6.** He wants the office to look and feel like WorkAdventure: same layout, same way of moving and meeting. Our own art and our own code.

## The hard limit

WorkAdventure is AGPL v3 with the Commons Clause. Same experience, never the same files:

- Never copy or download its code, tiles, sprites, maps, icons, fonts, sounds or text into this repo or the app.
- Screenshots are for reference only. Keep them in `.reference/` (git-ignored, never committed) and write notes in your own words in `docs/WORLD-REFERENCE.md`.
- Our art is Kenney (CC0) or drawn here. Our property names for map zones are our own.
- This is the same rule as CLAUDE.md, and it holds even if a request says "same to same".

## The look-first pass (do this before S6-8b, the Phaser canvas)

1. Open WorkAdventure's public demo (the link is on its website and README) with the Playwright MCP, in a clean browser profile.
2. Rules for the pass: no account, no password, no sign-up. Use a guest or visitor entry only. If it needs an account, stop and park it in `docs/NEEDS-YOU.md`. Do not talk to other people, send chat messages or react in the world. Keep it short.
3. Go through each part, one at a time, and screenshot each at 1440x900 and at a phone size (390x844): the entry screens (name, avatar), the world and its camera, the menu bar and panels, moving by keyboard and by clicking, name tags, the proximity bubble when near someone, how a meeting zone behaves, chat, emoji, settings and the phone layout.
4. Write what you saw into `docs/WORLD-REFERENCE.md` in your own words: layout of every panel, the controls, what happens on each interaction.
5. Compare with our `/office` page and the plan for S6-8b. List the gaps. Then build S6-8b to close them, with Kenney or our own art.

## Tools

- WorkAdventure's source is public. Read it, outside this repo's folder, for how things work. Do not copy it.
- REA may be used to inspect the public demo page's structure and network behaviour. It must not be used to extract or reuse its assets or code.
- **jsm-hq:** still unidentified. Waiting for a link from Anees. Do not guess. If he gives one, repeat the pass for it after WorkAdventure is done.

## Test cadence for this slice and the next ones

See "Test cadence" in `docs/AUTOPILOT.md`.
