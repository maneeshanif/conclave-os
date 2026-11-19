# Progress

Update after every task. A new session starts here.

- **Branch:** `dev`, the only working branch. It holds the spec v4 to v6, slice 0 and the slice 1 work in progress. One PR, `dev` into `master`, stays open until Anees merges it.
- **Last done:** slices 0 to 10 are built and tagged (slice-1-done to slice-10-done), to local stand-ins where a real account, key or machine is needed. Slices 7 to 10 were closed without a full-suite run.
- **Working now:** Whole plan built to stand-ins. Next: your call on the leftovers (see BUILD.md and NEEDS-YOU.md)
- **Next:** everything buildable is built; see docs/PARITY.md for the check against jsm-hq, Paperclip, WorkAdventure and the book, with what is still open (small doable items, and what is blocked on Anees: docs/NEEDS-YOU.md). The full suite ran once on 2026-11-20 and its 17 failures are fixed.
- **Resolved: the server not starting under `pnpm dev` on Windows.** Cause: `pnpm -r --parallel` gives each child an open stdin pipe. Fixed by `scripts/dev.mjs`; 8 of 8 real starts fine (see DECISIONS). A rare separate initdb stall is covered by the watchdog. Not yet seen again: a stalled start with the launcher.
- **Slice 1 already on `dev` (not reviewed):** tables and RLS migrations 0002/0003, `actions/policy.ts` (claim checks, footer, suppression), `actions/transport.ts` (outbox by default, Resend untested), `actions/email.ts` (claim-once executor, restart recovery), `propose_email` and `get_lead` os tools, kill switch check in the run loop. Not built: approvals, leads, suppression, kill-switch and action-item API routes; executor wiring in `index.ts`; the `outreach-rep` template; the approvals page; slice 1 tests; login and phone access.

- Slice 7 closed 2026-11-18 without a full-suite run (stopped at your request: one worker takes too long on this laptop). Every task ran its own tests plus neighbours; run `pnpm test -- --maxWorkers=2` when you have time.
