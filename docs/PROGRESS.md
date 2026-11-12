# Progress

Update after every task. A new session starts here.

- **Branch:** `dev`, the only working branch. It holds the spec v4 to v6, slice 0 and the slice 1 work in progress. One PR, `dev` into `master`, stays open until Anees merges it.
- **Last done:** S1-11 phone access: installable app (manifest, icons, shell service worker, offline page), device recorded on each approval, Android layout check (434 tests pass plus 5 mobile browser checks). Before it S1-10 owner login, S1-9 action items, S1-8 approvals inbox, S1-7 email executor wired, S1-6 outreach-rep, S1-5 settings, S1-4 leads, S1-3 gate, S1-2 approvals API, S1-1.
- **Working now:** S1-12, laptop, 2026-11-12 22:03:40
- **Next:** S1-12 slice 1 end to end and the tag slice-1-done, then slice 2. Your phone steps are in NEEDS-YOU. Parked for Anees: OpenCode key, free RAM for the local model test, read the outreach rep first drafts, phone setup. S0-15 is open.
- **Resolved: the server not starting under `pnpm dev` on Windows.** Cause: `pnpm -r --parallel` gives each child an open stdin pipe. Fixed by `scripts/dev.mjs`; 8 of 8 real starts fine (see DECISIONS). A rare separate initdb stall is covered by the watchdog. Not yet seen again: a stalled start with the launcher.
- **Slice 1 already on `dev` (not reviewed):** tables and RLS migrations 0002/0003, `actions/policy.ts` (claim checks, footer, suppression), `actions/transport.ts` (outbox by default, Resend untested), `actions/email.ts` (claim-once executor, restart recovery), `propose_email` and `get_lead` os tools, kill switch check in the run loop. Not built: approvals, leads, suppression, kill-switch and action-item API routes; executor wiring in `index.ts`; the `outreach-rep` template; the approvals page; slice 1 tests; login and phone access.
