# Progress

Update after every task. A new session starts here.

- **Branch:** `dev`, the only working branch. It holds the spec v4 to v6, slice 0 and the slice 1 work in progress. One PR, `dev` into `master`, stays open until Anees merges it.
- **Last done:** S1-12 slice 1 end to end: all four Done-when checks in one test; slice-1-done tagged (438 tests pass). Slice 1 is complete: S1-1 to S1-12.
- **Working now:** Slice 2 plan, laptop, 2026-11-12 22:11:50
- **Next:** slice 2 (clients, funnels and Lead Gen): draft its task list in BUILD.md, then build. For Anees to look at: run pnpm dev, open http://127.0.0.1:3000/approvals and /action-items; optional real Inngest check and the phone steps (NEEDS-YOU). Parked: OpenCode key, free RAM for the local model test, read the outreach rep first drafts. S0-15 is open.
- **Resolved: the server not starting under `pnpm dev` on Windows.** Cause: `pnpm -r --parallel` gives each child an open stdin pipe. Fixed by `scripts/dev.mjs`; 8 of 8 real starts fine (see DECISIONS). A rare separate initdb stall is covered by the watchdog. Not yet seen again: a stalled start with the launcher.
- **Slice 1 already on `dev` (not reviewed):** tables and RLS migrations 0002/0003, `actions/policy.ts` (claim checks, footer, suppression), `actions/transport.ts` (outbox by default, Resend untested), `actions/email.ts` (claim-once executor, restart recovery), `propose_email` and `get_lead` os tools, kill switch check in the run loop. Not built: approvals, leads, suppression, kill-switch and action-item API routes; executor wiring in `index.ts`; the `outreach-rep` template; the approvals page; slice 1 tests; login and phone access.
