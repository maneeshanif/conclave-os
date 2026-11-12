# Progress

Update after every task. A new session starts here.

- **Branch:** `dev`, the only working branch. It holds the spec v4 to v6, slice 0 and the slice 1 work in progress. One PR, `dev` into `master`, stays open until Anees merges it.
- **Last done:** S0-12, S0-13, S0-14, the initdb watchdog and data-safety guards, and the `pnpm dev` launcher fix, all on the Windows laptop (174 tests pass). Windows e2e: claude-cli PASS; opencode blocked by an expired OpenCode key (NEEDS-YOU).
- **Working now:** S1-1, laptop, 2026-11-12 19:56 PST
- **Next:** S1-1 to S1-12 in BUILD.md (slice 1: approvals and outreach), in order. Parked for Anees: OpenCode key, free RAM for the local model test (NEEDS-YOU). S0-15 is open.
- **Resolved: the server not starting under `pnpm dev` on Windows.** Cause: `pnpm -r --parallel` gives each child an open stdin pipe. Fixed by `scripts/dev.mjs`; 8 of 8 real starts fine (see DECISIONS). A rare separate initdb stall is covered by the watchdog. Not yet seen again: a stalled start with the launcher.
- **Slice 1 already on `dev` (not reviewed):** tables and RLS migrations 0002/0003, `actions/policy.ts` (claim checks, footer, suppression), `actions/transport.ts` (outbox by default, Resend untested), `actions/email.ts` (claim-once executor, restart recovery), `propose_email` and `get_lead` os tools, kill switch check in the run loop. Not built: approvals, leads, suppression, kill-switch and action-item API routes; executor wiring in `index.ts`; the `outreach-rep` template; the approvals page; slice 1 tests; login and phone access.
