# Progress

Update after every task. A new session starts here.

- **Branch:** `dev`, the only working branch. It holds the spec v4 to v6, slice 0 and the slice 1 work in progress. One PR, `dev` into `master`, stays open until Anees merges it.
- **Last done:** S6-3 where each agent is. S6-1, S6-2 done. Slices 1 to 5 done and tagged.
- **Working now:** Slice 6C leftovers (see BUILD.md), laptop, 2026-11-18 23:00:00
- **Next:** slice 7 (Engineering and Product; task list drafted in BUILD), then the slice 6C leftovers (audio and video bubbles, avatar parts, chat sync, conveyor and terminal, themed places, editor rooms and doors). Parked for Anees: see NEEDS-YOU. S0-15 is open.
- **Resolved: the server not starting under `pnpm dev` on Windows.** Cause: `pnpm -r --parallel` gives each child an open stdin pipe. Fixed by `scripts/dev.mjs`; 8 of 8 real starts fine (see DECISIONS). A rare separate initdb stall is covered by the watchdog. Not yet seen again: a stalled start with the launcher.
- **Slice 1 already on `dev` (not reviewed):** tables and RLS migrations 0002/0003, `actions/policy.ts` (claim checks, footer, suppression), `actions/transport.ts` (outbox by default, Resend untested), `actions/email.ts` (claim-once executor, restart recovery), `propose_email` and `get_lead` os tools, kill switch check in the run loop. Not built: approvals, leads, suppression, kill-switch and action-item API routes; executor wiring in `index.ts`; the `outreach-rep` template; the approvals page; slice 1 tests; login and phone access.

- Slice 7 closed 2026-11-18 without a full-suite run (stopped at your request: one worker takes too long on this laptop). Every task ran its own tests plus neighbours; run `pnpm test -- --maxWorkers=2` when you have time.
