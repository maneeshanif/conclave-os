# WorkAdventure — own-words reference

Date: 2026-11-15
Source: `/c/Users/HP/.conclave-os/reference/workadventure` (shallow clone, `maps/starter` inspected).
License (binding): `play/LICENSE.txt` = GNU AGPL v3 **with the Commons Clause**, plus a separate
commercial Enterprise edition. README also advertises a hosted SaaS.

Hard rule (never break): WorkAdventure is AGPL v3 + Commons Clause → for Conclave this is
**read-only look**. Do NOT copy sprites, skins, tilesets, maps, map assets, audio, video, logos,
or any code into Conclave. Notes + screenshots only, written in our own words, saved in
`.reference/` (git-ignored) and `docs/`. Our own art must be Kenney CC0 or drawn here (SPEC 12).

## What is in the repo (inventory — for "do not touch" awareness)

- **Bundled map assets** (in-repo, AGPL+Commons): `maps/assets/tileset1.png`, `tileset1-repositioning.png`,
  `tileset5_export.png`, `tileset6_export.png`, `Special_Zones.png`; `maps/assets/skins/*.png`
  (skin-blue/green/yellow — these are avatar skins); `maps/assets/audio/campfire.ogg`.
- **Starter world def** under `maps/starter/`: `map.json` (the Tiled/map descriptor), `bots.json`,
  `chatzone.json`, `script.js`. This is the "world" data a WA server serves.
- **Static front assets** under `play/public/static/`: logos, avatars (`yoda-avatar.png`,
  `default-companion.png`), bubbles (`say-bubble.png`, `think-bubble.png`), toolbar icons, GIFs,
  MP4s (screen share etc.), MP3. These are WorkAdventure's own brand/UI art — do not reuse.
- Docs images under `docs/map-building/images`, `docs/user/images`, `docs/developer/map-scripting/images`
  — screenshots/illustrations, not ours.

## What a WorkAdventure office world looks like (own words, from README + repo shape)

- Virtual office / virtual spaces as **customizable collaborative virtual worlds** ("metaverse").
- You have an **avatar** (the `skins/*.png` + `default-companion.png` line = per-user avatar art;
  default companions exist). The repo ships example avatar skins, which is exactly the kind of asset
  Conclave must NOT copy.
- **Proximity-based interaction**: video chat is triggered when you approach someone (README states
  this; docs include proximity-bubble, meetings, screen-sharing, picture-in-picture, phone-chat,
  say-think bubbles, raise-hand). So the "feel" is: walk around, get close, talk/video.
- **World = a map** (Tiled-style map descriptor `map.json` + tilesets + special zones), served by a
  WA map/maps/storage backend. Worlds are configurable; the `maps/starter` set is an example world.
- **Zones / objects**: `Special_Zones.png`, `chatzone.json`, `bots.json`, `script.js` suggest zoning
  (click spaces, meeting zones, teleport, scripted objects) on top of the tile map.
- **UI surface** (from README + docs): top bar, user list, availability status, global messages,
  notifications, phone chat, meetings (Jitsi/BigBlueButton-style), raise-hand, screen sharing, PiP.
- **Demo / hosted**: README points to a live demo and to a hosted SaaS. Public demo is the right place
  to do a look pass if we want screenshots — via Playwright, guest only.

## Look-pass plan (our own words + screenshots only)

1. Use the WA public demo (guest, no login) via Playwright. Save screenshots into `.reference/`
   (git-ignored), not into the repo as assets.
2. Write own-words notes into `docs/WORLD-REFERENCE.md`: top bar, panels, walking, avatar, name tags,
   zones, phone/meeting layout, proximity chat feel.
3. Build a small gap table against Conclave's current `/office`.
4. Do NOT download, copy, or reference any WA sprite/skin/tileset/map/video/audio in Conclave code,
   prompts, or generated images.

## "Use that images and all worlds" — interpretation + why it can't mean reuse

User instruction (from this session): after jsm-hq "code first", clone WorkAdventure and "use that
images and all worlds", then make more prompts from those images, then use a "google flow mcp server"
to create our own ones.

Interpretation I am operating under (confirm with user):
- "Use" = **study** the worlds and the look, then generate **our own** images/prompts. Not "import WA
  sprites into Conclave". That would breach AGPL + Commons Clause and Conclave's own SPEC 12 / CLAUDE.md
  rules.
- The "all worlds" part = learn how WA defines a world (map.json + tilesets + zones + script), so we
  can design our own world representation. We do not import WA's `maps/starter/map.json` or its tilesets.
- "More prompt from that images" = write image-generation prompts inspired by the look (our own wording,
  our own subject), not prompts that reproduce WA's sprites.
- "google flow mcp server" = an image-generation flow (likely DALL-E / GPT-image / an image-gen MCP
  server the user already has). I will not wire it until the user confirms which one and that any
  generated art is ours to use (CC0 / owned). Especially: do not prompt-for + reuse WA sprite likeness.

## What we can legitimately learn (techniques/concepts, in our own code)

- Proximity-driven interaction model (get close → talk/video) — as a UX idea for Conclave's office,
  implemented in our own code on top of our own map/state.
- World-as-map-with-zones concept — our own Tiled/own-map representation; Conclave already uses Tiled
  (SPEC 12), so align to that rather than importing WA's map format.
- Zones/objects/scripted interactions as a concept — our own object model (Conclave already has an
  object/place model in `packages/shared/src/office/`); extend that, don't import WA's.
- The general "open-plan office with desks + common areas + a plan board" spatial layout idea — ours
  to design.

## What NOT to do

- Do not copy `maps/assets/skins/*.png`, `default-companion.png`, `yoda-avatar*.png`, tilesets,
  `Special_Zones.png`, `play/public/static/images/*`, audio, video, or any `maps/starter/*` file into
  Conclave — not as assets, not as base layers for prompts, not inside generated images that reproduce
  them.
- Do not import WA's map format or server code.
- Do not treat the WA look as a spec to match pixel-for-pixel; treat it as inspiration for our own look.

## Second look at the reference starter map (2026-11-17, own words; study only, nothing copied)

I drew their 31 by 17 starter map into a local image (kept in `.reference/`, git-ignored) to see how an office is laid out. What makes it feel real: a strict top-down view; two columns of desks, each with a computer and a chair on both sides; a boardroom with one long glass table and eight chairs; a lounge with grey sofas, orange armchairs, plants and a rug; a kitchen counter with a coffee machine and a bin; clocks and a whiteboard on the walls; thick dark walls; layers for floor, walls, furniture and "above furniture" (drawn over people), and invisible zone layers for meeting rooms, a chill zone and a clock. Public pages add: small proximity bubbles for chats, unlimited meeting rooms, silent zones, and objects such as a computer that opens a website. Our S6-16 follows these ideas with our own Flow art and our own map.
