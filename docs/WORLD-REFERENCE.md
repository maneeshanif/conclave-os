# The world: what a WorkAdventure-style office looks like and does

Written 2026-11-14 for the WORLD-BRIEF look-first pass. **Notes in my own words from looking at the public demo as a guest.** Nothing here is copied: no code, tiles, sprites, maps, icons, fonts, sounds or text from that product is in this repo. The screenshots are in `.reference/` (git-ignored, never committed). Our art is Kenney (CC0) or drawn here; our map property names are our own.

How I looked: a clean browser profile, the public demo from the project's own README, entry as a guest (a name only, no account, no password). I did not chat, react, or talk to anyone. Headless software rendering would not draw the map, so the pass used a visible browser window with the real GPU. 1440x900 and 390x844 (phone, touch).

## The way in (guest)

1. **Name.** One field, "enter your name", one Continue button, and a line about terms. The blurred world shows behind it, so you see where you are going.
2. **Avatar.** A card with a large preview of the character and a small refresh button, a "pick one at random" button, a grid of ready-made characters, and two buttons: build your own, and Continue.
3. **Camera and microphone.** A page with a card each for microphone (with a live level bar), camera (with a live preview) and sound output, each with an "edit" button and a green tick on the active device, and one Save button. Skippable in spirit: nothing is forced.
4. **Loading.** The product's name over a thin progress bar on the blurred world.
5. **A welcome card** over the dimmed world: a title, one paragraph, and two buttons, "Let's go!" for a short tour and "Skip tutorial".

## The world

- **Zoomed in.** The map is large and you see a small part of it at roughly twice our scale. The camera follows your avatar and eases into position.
- **You start on a welcome mat**, a floor panel with the word on it. It is also a silent zone: the mat itself shows muted-microphone and muted-camera icons and the words "silent zone", and a red notice pill appears under the top bar saying nobody can talk to you here and that your microphone and camera are off.
- **A hint pill** in the middle of the screen: "Want to talk? Just move with the arrow keys and come meet us!" It goes away once you move.
- **Name tag** over each avatar: a small dark rounded label with a coloured status dot (red in a silent zone, green when online) and the name.
- **Rooms and areas are painted on the floor** with big faint words ("MEETING ROOM", "OFFICE"), tinted patches, furniture, plants, signs, arcade cabinets. Some floor areas are zones (the welcome mat is the silent one).
- **Moving.** Arrow keys walk smoothly in a held direction (not one tile per press). A click walks you to that spot along a path. The avatar has a walking animation in four directions.
- **Bottom right, a small column:** zoom in, zoom out, and "explore the room" (an overview of the whole map).

## The top bar (desktop)

Floating rounded groups on a dark translucent background, not a full-width bar:

- **Far left:** a chat button and a people button (the people button shows who is online).
- **Centre:** an emoji reaction button, an apps/actions grid button, microphone and camera toggles (each with a small red dot when off).
- **Right:** a Share button and a bright Login button; a Tools drop-down (explore the room, room list); and a profile drop-down showing a small face, the name and the status dot.
- **Profile menu** (opens down from the name): connect an outside account (two buttons), "change your status" (a list with a tick on the current one), profile (edit your name, customise your avatar, add a companion), settings (edit camera and microphone, report an issue, all settings, help and tips).
- **Left panel** (opens from the chat or people button, pushes the map over): a header with the number of users online, a "sign in to read the chat" card when you are a guest, and a list below it starting with the proximity chat (the chat with whoever is near you). A close button sits at the top of the map side.

## The phone layout (390 wide)

- The map fills the screen. The top bar is gone.
- **A bottom row of big rounded buttons:** chat on the left; microphone and camera with a small expander above them; Login; and a menu (three lines) on the right.
- Zoom controls stay at the right edge, above the bottom row. Notices (the silent zone one) sit as a pill just above the bottom row.
- Touch: tapping the map walks you there.

## Not seen (and why)

- **The bubble when you are near someone**, a meeting zone's behaviour, and emoji reactions: nobody was near, and the brief says not to talk to or react at people. Written from the brief and the docs instead: when two avatars are close, a bubble opens with their video; walking away closes it; a meeting zone can be locked, limited and so on (the same ideas as S6-5).
- **The chat itself**: it needs a sign-in, so it was not opened beyond the sign-in card.

## Our `/office` today (S6-8a, S6-8b) against that

| Part | Them | Us now | Gap |
| --- | --- | --- | --- |
| Camera | Zoomed in, follows you, zoom buttons, overview button | Whole map shrunk to fit, follows you | Zoom in by default; zoom and overview controls |
| Walking | Smooth held-key walking, click to walk, animated four-way sprite | One tile per key press, click to walk, a red dot | Held-key repeat; sprite with walking frames |
| Avatar | Character sprites, picker at entry | Red dot; blue dots with initials for agents | Our own or Kenney CC0 sprites; a simple picker |
| Name tags | Label with status dot over each avatar | Initials in the dot only | Name label with availability dot |
| Floor | Dense, furnished, painted room names | Flat tiles, a text label | Room names on the floor, tinted zones, furniture from CC0 tiles |
| Zone notices | A pill when you enter a zone (silent) | None | A pill from the room's own properties (S6-5) |
| First visit | Welcome card with a tour and skip | None | One short card, skippable, shown once |
| Top bar | Floating groups: people, tools, status, profile | A plain nav and a heading | Floating bar: people, tools (explore, rooms), availability menu |
| Side panel | People list and chat, pushes the map | Plain list below the map; the agent drawer in the list | A left panel with who is here, and the agent drawer in it |
| Phone | Bottom row of big buttons, zoom at the edge | Small canvas, then the list | Bottom row (people, status, menu), zoom at the edge |
| Meeting | Proximity bubble with video | Not in scope (no video) | Proximity bubble as a text drawer only (already S6-6) |

Things we deliberately do not copy: video and microphone (out of scope), outside account links, the sign-in wall, the Login button.

## Plan to close the gaps (added to docs/BUILD.md as S6-8c)

1. **S6-8c1, camera and walking.** Default zoom around 2x, zoom in and out, overview; held-key walking at a steady speed; click to walk. Logic in the controller with tests; the scene only draws.
2. **S6-8c2, the bar and panels.** Floating bar, people panel, tools menu, availability menu (from S6-5), the left panel with the agent drawer, zone notice pills, the one-time welcome card, the phone bottom row. Tested as components, and checked in the browser at both sizes.
3. **S6-8c3, art.** Kenney CC0 tiles and character sprites, or our own drawn ones; name labels with availability dots; room names painted on the floor; tinted zones. Licence file kept with the art.
4. Then S6-9 (a second person in the same office), S6-10 and S6-11 as planned.
