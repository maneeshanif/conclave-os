# Character sheets made in Google Flow

Besides the characters there are `objects-a.png` and `objects-b.png` (the sixteen office objects), `furniture.png` (desk, chair, plant, sofa, table, tree) and `tiles.png` (eight floor and wall swatches), made the same way with our own prompts. `scripts/import-flow-objects.mjs` and `scripts/import-flow-tiles.mjs` slice them.

Each `look-<n>.png` is one character sheet (3 columns by 4 rows, plain grey background) generated on 2026-11-17 by Anees's own Google Flow account with the model "Nano Banana 2", from the prompt kept in `docs/AGENT-WORKLOG-OFFICE-LOOK.md`. They are our own generated art: nothing was traced from or based on WorkAdventure, jsm-hq or any other product's sprites. `node scripts/import-flow-looks.mjs` slices them into `apps/web/public/office/people.png` (the right-facing row is the left-facing row mirrored).

Check Google Flow's current terms for commercial use of generated images before shipping to customers; this repo does not decide that for you.
