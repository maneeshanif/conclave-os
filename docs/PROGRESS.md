# Progress

Update after every task. A new session starts here.

- **Branch:** `dev`, the only working branch. It holds the spec v4 to v6, slice 0 and the slice 1 work in progress. One PR, `dev` into `master`, stays open until Anees merges it.
- **Last done:** S2-10 the morning brief (599 tests pass). Before it S2-9 Goals, S2-8 heartbeats, S2-7 leadgen-kit, S2-6 numbers, S2-5 runner, S2-4 threads, S2-3 campaigns, S2-2 funnels, S2-1 accounts; slice 1 is complete and tagged.
- **Working now:** S2-11, laptop, 2026-11-13 00:09:41
- **Next:** S2-11 inbox, pipeline and campaigns pages, then S2-12 deal-desk and client-success templates and S2-13 the slice end to end (BUILD.md). Optional: BRIEF_TIME and COMPANY_TIMEZONE in .env. Parked for Anees: OpenCode key, free RAM for the local model test, read the outreach rep first drafts, phone setup, optional real Inngest check, lead-source accounts (NEEDS-YOU). S0-15 is open.
- **Resolved: the server not starting under `pnpm dev` on Windows.** Cause: `pnpm -r --parallel` gives each child an open stdin pipe. Fixed by `scripts/dev.mjs`; 8 of 8 real starts fine (see DECISIONS). A rare separate initdb stall is covered by the watchdog. Not yet seen again: a stalled start with the launcher.
- **Slice 1 already on `dev` (not reviewed):** tables and RLS migrations 0002/0003, `actions/policy.ts` (claim checks, footer, suppression), `actions/transport.ts` (outbox by default, Resend untested), `actions/email.ts` (claim-once executor, restart recovery), `propose_email` and `get_lead` os tools, kill switch check in the run loop. Not built: approvals, leads, suppression, kill-switch and action-item API routes; executor wiring in `index.ts`; the `outreach-rep` template; the approvals page; slice 1 tests; login and phone access.
