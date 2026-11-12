# Progress

Update after every task. A new session starts here.

- **Branch:** `dev`, the only working branch. It holds the spec v4 to v6, slice 0 and the slice 1 work in progress. One PR, `dev` into `master`, stays open until Anees merges it.
- **Last done:** S0-13 on the laptop (Windows): 134 tests pass here. S0-12 before it. Slice 0 S0-1 to S0-11 and review fixes 1 to 3 were built in the cloud on Linux.
- **Working now:** S0-14, laptop, 2026-11-12 18:27 PST
- **Next:** S0-14, then pnpm run doctor and pnpm run e2e on this laptop, the local model check, then draft and build slice 1.
- **Slice 1 already on `dev` (not reviewed):** tables and RLS migrations 0002/0003, `actions/policy.ts` (claim checks, footer, suppression), `actions/transport.ts` (outbox by default, Resend untested), `actions/email.ts` (claim-once executor, restart recovery), `propose_email` and `get_lead` os tools, kill switch check in the run loop. Not built: approvals, leads, suppression, kill-switch and action-item API routes; executor wiring in `index.ts`; the `outreach-rep` template; the approvals page; slice 1 tests; login and phone access.
