# Progress

Update after every task. A new session starts here.

- **Branch:** `dev`, the only working branch. It holds the spec v4 to v6, slice 0 and the slice 1 work in progress. One PR, `dev` into `master`, stays open until Anees merges it.
- **Last done:** S0-12, S0-13, S0-14 on the laptop (Windows), then an initdb watchdog and data-safety guards: 170 tests pass here.
- **Working now:** pnpm run e2e on the laptop, laptop, 2026-11-12 19:26 PST
- **Next:** pnpm run doctor and pnpm run e2e on this laptop, the local model check (ollama list, GPU), then draft and build slice 1.
- **OPEN, unexplained: the server sometimes never starts under tsx on the Windows laptop.** About 1 start in 10 prints nothing and never listens. One stall was traced into the library's initdb (`before initialise` printed, `after initialise` did not). After the initdb watchdog went in, 2 of 25 starts still stalled and the watchdog never fired (0 restarts), so those two stalls are NOT in initdb; their logs are empty and the place is unknown. Next step: trace again over many rounds, now that initdb is covered. Do not build slice 1 on this until it is understood.
- **Slice 1 already on `dev` (not reviewed):** tables and RLS migrations 0002/0003, `actions/policy.ts` (claim checks, footer, suppression), `actions/transport.ts` (outbox by default, Resend untested), `actions/email.ts` (claim-once executor, restart recovery), `propose_email` and `get_lead` os tools, kill switch check in the run loop. Not built: approvals, leads, suppression, kill-switch and action-item API routes; executor wiring in `index.ts`; the `outreach-rep` template; the approvals page; slice 1 tests; login and phone access.
