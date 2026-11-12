# Progress

Update after every task. A new session starts here.

- **Branch:** `dev`, the only working branch. It holds the spec v4 to v6, slice 0 and the slice 1 work in progress. One PR, `dev` into `master`, stays open until Anees merges it.
- **Last done:** S2-13 slice 2 end to end; slice-2-done tagged (640 tests pass). Slice 2 is complete: S2-1 to S2-13. Slice 1 is complete and tagged.
- **Working now:** S3-1, laptop, 2026-11-13 01:51:57
- **Next:** slice 3 (reliability): draft its task list in BUILD.md, then build. For Anees to look at in a browser: /approvals /action-items /inbox /pipeline /campaigns /brief /goals. Set your own goal targets (company/goals.yaml) and COMPANY_TIMEZONE / BRIEF_TIME in .env. Parked: OpenCode key, free RAM for the local model test, read the outreach rep first drafts, phone setup, optional real Inngest check, lead-source accounts (NEEDS-YOU). S0-15 is open.
- **Resolved: the server not starting under `pnpm dev` on Windows.** Cause: `pnpm -r --parallel` gives each child an open stdin pipe. Fixed by `scripts/dev.mjs`; 8 of 8 real starts fine (see DECISIONS). A rare separate initdb stall is covered by the watchdog. Not yet seen again: a stalled start with the launcher.
- **Slice 1 already on `dev` (not reviewed):** tables and RLS migrations 0002/0003, `actions/policy.ts` (claim checks, footer, suppression), `actions/transport.ts` (outbox by default, Resend untested), `actions/email.ts` (claim-once executor, restart recovery), `propose_email` and `get_lead` os tools, kill switch check in the run loop. Not built: approvals, leads, suppression, kill-switch and action-item API routes; executor wiring in `index.ts`; the `outreach-rep` template; the approvals page; slice 1 tests; login and phone access.
