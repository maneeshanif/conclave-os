# Progress

Update after every task. A new session starts here.

- **Branch:** `dev`, the only working branch. It holds the spec v4 to v6, slice 0 and the slice 1 work in progress. One PR, `dev` into `master`, stays open until Anees merges it.
- **Last done:** S3-12 disk guards; slice 3 complete and tagged (784 tests pass). Slices 1, 2 and 3 are done.
- **Working now:** S4-2, laptop, 2026-11-13 04:39
- **Next:** after the disk is cleared: rerun the suite, tag slice-3-done, then S4-2 (install @openai/agents, check its docs first). Parked for Anees: see NEEDS-YOU.
- **Resolved: the server not starting under `pnpm dev` on Windows.** Cause: `pnpm -r --parallel` gives each child an open stdin pipe. Fixed by `scripts/dev.mjs`; 8 of 8 real starts fine (see DECISIONS). A rare separate initdb stall is covered by the watchdog. Not yet seen again: a stalled start with the launcher.
- **Slice 1 already on `dev` (not reviewed):** tables and RLS migrations 0002/0003, `actions/policy.ts` (claim checks, footer, suppression), `actions/transport.ts` (outbox by default, Resend untested), `actions/email.ts` (claim-once executor, restart recovery), `propose_email` and `get_lead` os tools, kill switch check in the run loop. Not built: approvals, leads, suppression, kill-switch and action-item API routes; executor wiring in `index.ts`; the `outreach-rep` template; the approvals page; slice 1 tests; login and phone access.
