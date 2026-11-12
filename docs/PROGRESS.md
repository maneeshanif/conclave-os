# Progress

Update after every task. A new session starts here.

- **Branch:** `dev`, the only working branch. It holds the spec v4 to v6, slice 0 and the slice 1 work in progress. One PR, `dev` into `master`, stays open until Anees merges it.
- **Last done:** S3-9 the daily backup. Before it S3-8 eval gate, S3-7 Health screen, S3-6 breakers, S3-5 output checks, S3-4 budgets, S3-3 plan limits, S3-2 retry, S3-1 the reaper. Slices 1 and 2 are complete and tagged.
- **Working now:** S3-10, laptop, 2026-11-13 03:56:43
- **Next:** S3-10 lite mode, S3-11 slice 3 end to end, then slice 4 (BUILD.md). Parked for Anees: see NEEDS-YOU. S0-15 is open.
- **Resolved: the server not starting under `pnpm dev` on Windows.** Cause: `pnpm -r --parallel` gives each child an open stdin pipe. Fixed by `scripts/dev.mjs`; 8 of 8 real starts fine (see DECISIONS). A rare separate initdb stall is covered by the watchdog. Not yet seen again: a stalled start with the launcher.
- **Slice 1 already on `dev` (not reviewed):** tables and RLS migrations 0002/0003, `actions/policy.ts` (claim checks, footer, suppression), `actions/transport.ts` (outbox by default, Resend untested), `actions/email.ts` (claim-once executor, restart recovery), `propose_email` and `get_lead` os tools, kill switch check in the run loop. Not built: approvals, leads, suppression, kill-switch and action-item API routes; executor wiring in `index.ts`; the `outreach-rep` template; the approvals page; slice 1 tests; login and phone access.
