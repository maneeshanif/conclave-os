# Progress

Update after every task. A new session starts here.

- **Branch:** `dev`, the only working branch. It holds the spec v4 to v6, slice 0 and the slice 1 work in progress. One PR, `dev` into `master`, stays open until Anees merges it.
- **Last done:** S1-8 the approvals inbox page at /approvals (372 tests pass on the laptop). Before it S1-7 the email executor wired into the server, S1-6 outreach-rep and outreach-kit, S1-5 settings and kill switch, S1-4 leads and suppression, S1-3 the approval gate, S1-2 the approvals API, S1-1.
- **Working now:** S1-9, laptop, 2026-11-12 21:29 PST
- **Next:** S1-9 (action items) onward in BUILD.md. The inbox exists now: run pnpm dev and open http://127.0.0.1:3000/approvals. Parked for Anees: OpenCode key, free RAM for the local model test, read the outreach rep first drafts before promoting it (NEEDS-YOU). S0-15 is open. S1-12 has a one-off real Inngest check and a browser check of the pages.
- **Resolved: the server not starting under `pnpm dev` on Windows.** Cause: `pnpm -r --parallel` gives each child an open stdin pipe. Fixed by `scripts/dev.mjs`; 8 of 8 real starts fine (see DECISIONS). A rare separate initdb stall is covered by the watchdog. Not yet seen again: a stalled start with the launcher.
- **Slice 1 already on `dev` (not reviewed):** tables and RLS migrations 0002/0003, `actions/policy.ts` (claim checks, footer, suppression), `actions/transport.ts` (outbox by default, Resend untested), `actions/email.ts` (claim-once executor, restart recovery), `propose_email` and `get_lead` os tools, kill switch check in the run loop. Not built: approvals, leads, suppression, kill-switch and action-item API routes; executor wiring in `index.ts`; the `outreach-rep` template; the approvals page; slice 1 tests; login and phone access.
