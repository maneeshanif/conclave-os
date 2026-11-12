# Progress

Update after every task. A new session starts here.

- **Branch:** `dev`, the only working branch. It holds the spec v4 to v6, slice 0 and the slice 1 work in progress. One PR, `dev` into `master`, stays open until Anees merges it.
- **Last done:** S1-9 action items: API, migration 0007 and the Needs you page (390 tests pass on the laptop). Before it S1-8 approvals inbox, S1-7 email executor wired, S1-6 outreach-rep, S1-5 settings and kill switch, S1-4 leads, S1-3 gate, S1-2 approvals API, S1-1.
- **Working now:** S1-10, laptop, 2026-11-12 21:39 PST
- **Next:** S1-10 owner login (Better Auth passkeys; check its current docs first) onward in BUILD.md. Pages to look at: /approvals and /action-items. Parked for Anees: OpenCode key, free RAM for the local model test, read the outreach rep first drafts before promoting it (NEEDS-YOU). S0-15 is open. S1-12 has a real Inngest check and a browser check.
- **Resolved: the server not starting under `pnpm dev` on Windows.** Cause: `pnpm -r --parallel` gives each child an open stdin pipe. Fixed by `scripts/dev.mjs`; 8 of 8 real starts fine (see DECISIONS). A rare separate initdb stall is covered by the watchdog. Not yet seen again: a stalled start with the launcher.
- **Slice 1 already on `dev` (not reviewed):** tables and RLS migrations 0002/0003, `actions/policy.ts` (claim checks, footer, suppression), `actions/transport.ts` (outbox by default, Resend untested), `actions/email.ts` (claim-once executor, restart recovery), `propose_email` and `get_lead` os tools, kill switch check in the run loop. Not built: approvals, leads, suppression, kill-switch and action-item API routes; executor wiring in `index.ts`; the `outreach-rep` template; the approvals page; slice 1 tests; login and phone access.
