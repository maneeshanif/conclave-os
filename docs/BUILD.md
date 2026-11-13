# Build plan

The spec is `docs/SPEC.md`. Section 18 lists ten slices. Only one slice is open at a time.

## Current slice: 0, Skeleton

**Done when:** one agent made from a template takes a task and runs on the signed-in Claude Code CLI, the same template runs on OpenCode after a one-line change to its role file, every step of the run is readable on a plain web page, and `pnpm doctor` prints memory use.

**Stop rule:** do not open slice 1 until slice 0 is something you use.

**Why two engines in slice 0:** the OS must not depend on one harness or one model (SPEC 5, the portability rule). Two runtimes passing the same conformance tests prove that before anything is built on top.

## Autopilot

Autopilot is on: see `docs/AUTOPILOT.md`, `docs/QUESTIONS.md` and `docs/PROGRESS.md`.

## Kickoff prompt (paste this into Claude Code once)

```text
Read CLAUDE.md and docs/BUILD.md. Then read only these SPEC sections: 1, 5, 7, 11 and 13.
I am on Windows, so use paths and scripts that work in PowerShell, and put DATA_DIR in my user folder.
Do not write code yet. Tell me in ten lines or fewer what slice 0 builds and what it leaves out.
Then propose a plan for task S0-1 only, and wait for my OK.
```

## Prompt for every later session

```text
Read CLAUDE.md and docs/BUILD.md. The current task is <TASK ID>.
Read only the SPEC sections that task lists. Write the acceptance test first,
show me your plan, wait for my OK, then build until the test passes.
Tick the task in docs/BUILD.md, commit, and push.
```

## Slice 0 tasks

Work them in order. Tick each when its test passes.

- [x] **S0-1 Monorepo scaffold.** SPEC 13.
  pnpm workspace with `apps/server` (Hono), `apps/web` (Next.js), `packages/shared` (Zod schemas), `packages/cli`, TypeScript, ESLint and Vitest. Both apps listen on 127.0.0.1 only.
  *Test:* `pnpm test` passes a server health check, and `pnpm dev` starts the server and the web app.

- [x] **S0-2 Database and tenancy.** SPEC 11, the "tenancy rule" and the slice 0 SQL block only.
  Embedded Postgres that starts with the server and keeps its files under `DATA_DIR`. Drizzle schema and migrations for the twelve slice 0 tables exactly as that block gives them. The server connects as a non-superuser role that does not own the tables, row-level security is enabled and forced, and each request sets `app.workspace_id` in its transaction. Do not create the vector extension. On first start, create one workspace in local mode.
  *Test:* a query made as workspace A cannot read a row that belongs to workspace B, and a query with no workspace set returns no rows.

- [x] **S0-3 Company folder loader.** SPEC 5 (role file), 7 (model aliases), 13.
  Read `company/COMPANY.md`, `company/goals.yaml`, `company/departments.yaml` and every `company/departments/<dept>/agents/<id>/AGENT.md`. Validate with Zod. Sync departments, agents and goals to the database by `key`. The role file is the source of truth for its front matter. `config/models.ts` maps each alias to a model and the runtimes it works on.
  *Test:* the starter `company/` folder loads nineteen departments and three ladder goals. A role file with an unknown `runtime` is rejected with a clear message, and so is one whose model alias does not list its runtime.

- [x] **S0-4 Template renderer with two targets.** SPEC 5 (templates, default permissions, how grants reach a CLI, the portability rule).
  Three templates in `templates/agents`: `lead`, `researcher`, `writer`. Each holds neutral sources only: `template.yaml`, `AGENT.md.hbs`, `RULES.md.hbs`, `permissions.yaml`, `connectors.yaml` and `skills/`. `render(template, params)` writes `AGENT.md` to `company/departments/<dept>/agents/<id>/`, and writes the working folder under `DATA_DIR` for the agent's runtime. The `claude-cli` target writes `CLAUDE.md`, `.claude/settings.json`, `.claude/skills` and `.mcp.json`. The `opencode` target writes `AGENTS.md`, an agent file in `.opencode/agents/`, `opencode.json` and the same `.claude/skills` folder. Check OpenCode's current docs for its config shape before writing that target. Default permissions give no shell and no network-writing tool on either target. Add `pnpm agent:new <template> --department <key>`, which renders and registers the agent as `active` at autonomy 0 (slice 0 has no approvals inbox yet).
  *Test:* a snapshot of the rendered `writer` for each target. A missing required parameter fails. The working folder is not inside the repo. Neither rendered folder grants a shell.

- [x] **S0-5 The `os` MCP server.** SPEC 6 ("How a CLI agent reaches these tools"), 8.
  An HTTP MCP endpoint on the server, bound to 127.0.0.1, with `get_task`, `comment`, `complete_task`, `block_task` and `ask_founder`. Each call carries a per-run token that the server resolves to workspace, agent, run and task. The agent does not check tasks out; the run loop does (S0-8).
  *Test:* a call with no token is refused, and a call with another run's token cannot touch this run's task.

- [x] **S0-6 CLI runtime, two engines.** SPEC 5 (the runner, "Three things this runner must get right", "One trap per engine"), 7.
  `runtimes/types.ts` and `runtimes/cli.ts` for `claude-cli` and `opencode`. Before each run, write the per-run token into the agent's connector config. Spawn the CLI headless in the agent's working folder with a clean environment. Turn its JSON lines into run events, store them, capture the session id, and classify a plan-limit or sign-in message as its own error kind. Run `claude --help` and `opencode run --help` first and use the real flags, not the ones in the spec sketch. Nothing outside `runtimes/` and the renderer targets may name a harness.
  *Test:* with a fake `claude` script that prints canned JSON lines, the events are stored in order and the run ends `succeeded`. A second fake that exits non-zero ends `failed`. A third that prints a plan-limit line ends `failed` with kind `limit`. The same three cases pass with a fake `opencode`. The child's environment holds no variable from `.env` except those in the model alias.

- [x] **S0-7 Runtime conformance tests.** SPEC 5 (the portability rule, rule 3).
  `runtimes/conformance.ts`: one test suite that takes any `Runtime` and checks the seven points in rule 3. Run it against `claude-cli` and `opencode` using the fake binaries. Later runtimes must pass the same suite before an agent may use them.
  *Test:* both runtimes pass. A deliberately broken runtime that leaks an environment variable fails with a message naming the variable.

- [x] **S0-8 Run loop and ticker.** SPEC 5 (the eight steps), 11 ("One event starts every run"), 14 (limits).
  An Inngest function `agent-run`, triggered by `agent/run.requested`, with the two concurrency limits in SPEC 14. It checks in plain code whether the agent has a task before any model call, then checks the task out with the atomic update. `POST /agents/:id/run` sends the event. A `ticker` function on a one-minute cron sends it for agents whose `heartbeat_cron` is due. The loop picks the runtime from the agent's role file and never names one itself.
  *Test:* a run for an agent with no tasks makes no CLI call. Two run requests at the same moment never check out the same task.

- [x] **S0-9 Plain task page.** SPEC 11 (API table), 12 (stack only).
  One web page: the task list, a form to create a task, and a live log of a run over a WebSocket, with its state, the runtime it ran on, and the cost estimate if the CLI reported one. No office canvas, no login (it only answers on 127.0.0.1).
  *Test:* a component test that a stored run's events render in order.

- [x] **S0-10 `pnpm run doctor`.** (Plain `pnpm doctor` is pnpm's own command.) SPEC 17.
  Check Node and pnpm versions, that `claude` is on the path and signed in, that the database and Inngest are reachable, that the server is bound to 127.0.0.1, and that `DATA_DIR` is outside the repo. Report `opencode` as ready, not signed in, or missing; a missing `opencode` is a warning, not a failure. Print memory use of the server and database processes.
  *Test:* doctor exits non-zero and names the problem when `claude` is not on the path, and exits zero with a warning when only `opencode` is missing.

- [x] **S0-11 End to end, on both engines.** Now one command: start `pnpm dev`, then `pnpm run e2e`. Passed in the cloud on Linux with real Claude Code and real OpenCode (on a stand-in model). Run it once on your Windows machine before opening slice 1.
  Run `pnpm agent:new researcher --department research`. Give it the task "List five facts from the company file, each with the line it came from", with `company/COMPANY.md` passed in the task context. Fire a run. Then change the role file's `runtime` to `opencode` and its `model` to an alias that lists `opencode`, render again, and fire the same task.
  *Test, by hand:* both runs end `done`, each answer is in its task thread, every step is visible on the task page, and neither run log contains text from this repo's `CLAUDE.md`. If OpenCode is not installed or has no provider yet, record that in `docs/DECISIONS.md` and leave this box unticked until it is.

- [x] **S0-12 Windows process handling.** SPEC 5 (the runner), 14.
  Resolve an npm `.cmd` shim to `node` plus its script and spawn without a shell; quote `health()` arguments the same way. On win32, cancel with `taskkill /pid <pid> /T /F` so the child's own children die too.
  *Test:* unit tests for the shim resolver on a fake `.cmd` file and for the kill command chosen per platform; by hand on Windows, a cancelled run leaves no `claude` or `opencode` process.

- [x] **S0-13 Heartbeats and turn counting.** SPEC 5, 11 ("One event starts every run"), 14.
  Remember each agent's last heartbeat tick in memory so an idle agent is not requested every minute, and drop a run request when one is already queued for that agent. Count Claude turns by distinct `message.id`, not by event.
  *Test:* ten ticks in one minute queue at most one request per agent; a stream with one message split over three events counts one turn.

- [x] **S0-14 Task ownership in the os tools.** SPEC 6, 11.
  `comment`, `complete_task`, `block_task` and `ask_founder` act only when the task is `in_progress` and `locked_by` is the calling agent. `PATCH /api/tasks/:id` clears `locked_by` when it moves a task out of `in_progress`. Add a test that `createWorkflows` registers both functions with the two concurrency limits.
  *Test:* a token for a run whose task was moved back to `todo` cannot complete it; the Inngest config test passes.

- [ ] **S0-15 The e2e leaves the repo alone.** SPEC 13.
  `pnpm run e2e` hires its researcher into the repo's `company/` when none exists, so every run leaves `company/departments/research/...` untracked. Point it at its own company folder (`COMPANY_DIR` already exists for that) and remove the folder when it ends. Also retry the OpenCode half once Anees has replaced the expired OpenCode key (NEEDS-YOU).
  *Test:* after `pnpm run e2e`, `git status` shows no new files in the repo.

## Slice 1: Approvals and Outreach

**Done when (SPEC 18):** a lead goes from audit to approved email to sent; the kill switch stops everything; an agent told to send an email by any other route fails; and an approval decided after a restart still sends exactly once.

**Hard limits for this slice.** Real transports stay off: sending goes to the outbox (a folder of files), never to a real address, and the Resend adapter stays unused until Anees turns it on in `.env`. No account is created and no secret is asked for. Login is the owner only (Q10); roles stay in the schema for slice 9.

**Already on `dev`, not reviewed:** tables and RLS migrations 0002/0003, `actions/policy.ts` (claim checks, footer, suppression), `actions/transport.ts` (outbox by default, Resend untested), `actions/email.ts` (claim-once executor, restart recovery), the `propose_email` and `get_lead` os tools, the kill-switch check in the run loop. S1-1 gives them tests before anything is built on them.

- [x] **S1-1 Test what is already there.** SPEC 6 (rules around the gate), 14, 15.
  Write the missing tests for `policy.ts`, `transport.ts`, `email.ts`, the two os tools and the kill-switch check, and fix what they find. Read the slice 1 migrations against the tenancy rule: every table has `workspace_id`, composite keys and forced RLS, and the existing tenancy test must cover them.
  *Test:* the claim checks block medical, legal and pricing claims; a suppressed or do-not-contact address is refused by `propose_email`; the outbox transport writes one file per approval; the executor claims `approved` to `executing` once and a second claim does nothing; the table-driven RLS test lists every slice 1 table.

- [x] **S1-2 Approvals API.** SPEC 6, 11 (API table).
  `GET /api/approvals?status=`, `GET /api/approvals/:id`, `POST /api/approvals/:id/decide` with `approved` or `rejected` and an optional edited payload. Decisions go through one state machine (`pending` to `approved` or `rejected`, never back), record who and when, and publish `approval/decided`.
  *Test:* deciding twice is refused; an edited payload is stored and is what the executor will use; a rejected approval is never executable; a decision for another workspace's approval is a 404.

- [x] **S1-3 The gate workflow, and restart recovery.** SPEC 6 (how the gate is built, three rules), 11, 14.
  `approval-gate` on Inngest and its in-process equivalent, with the same behaviour: wait for the decision (3 day timeout marks it `expired`), then run the executor once. On server start, request again every `pending` approval that has no live wait. The execute step never retries.
  *Test:* an approval decided after a simulated restart sends exactly once; two executors racing for one approval send once; a pending approval left over from before a restart is picked up; an expired approval never sends.

- [x] **S1-4 Leads and the suppression list.** SPEC 10, 15.
  `POST/GET/PATCH /api/leads` (create, list, one lead, stage and do-not-contact) and `GET/POST/DELETE /api/suppression`. Addresses are normalised and matched case-insensitively. An unsubscribe adds to the list and nothing removes it silently.
  *Test:* a lead marked do-not-contact is refused by `propose_email`; adding an address to the list blocks proposals for it in any case; removing needs an explicit call and is logged in `audit_log`.

- [x] **S1-5 Settings, the kill switch and the send caps.** SPEC 6, 14, 15; QUESTIONS 9.
  `workspace_settings` holds the kill switch and the caps: `window_hours` = 5 and `window_cap` = 30 (a rolling window), plus a per-day cap. Follow-ups count in the same window. `GET/PATCH /api/settings`. With the kill switch on: no new run starts, running runs are cancelled, queued requests are dropped, and no executor sends, including approvals already approved.
  *Test:* the 31st email inside five hours is held and the 31st after the window moves is allowed; the kill switch stops a running fake run, empties the queue and blocks an executor on an already-approved email; turning it off does not resurrect dropped work.

- [x] **S1-6 The `outreach-rep` template and `outreach-kit`.** SPEC 5 (templates, default permissions), 8, 10.
  A neutral template for the first-touch writer: role file, rules, `permissions.yaml` (the `os` tools only, no shell, no network write), a procedure skill for the first email, and an output check. `outreach-kit` carries the skill and the connector entry.
  *Test:* a snapshot of the rendered folder for both engines; neither grants a shell or a network-writing tool; through the conformance suite's `forbidden` mode, an attempt to send by any route other than `propose_email` is refused and nothing is sent.

- [x] **S1-7 The email executor, wired.** SPEC 6, 14, 15.
  Register the executor with the gate in `index.ts`. Sending requires the footer address from `company/` and a transport; with no footer the approval ends `failed` with that reason and nothing is sent. The outbox is the default transport; Resend is selected only by an explicit setting. Every send records the outcome on `outreach_messages` and in `audit_log`.
  *Test:* an approved email lands in the outbox exactly once; with the footer unset the executor refuses and says why; a blocked claim added after approval is still refused at send time; the outbox is the transport unless the setting says otherwise.

- [x] **S1-8 The approvals inbox page.** SPEC 12.
  A web page listing pending cards: for an email, the recipient, the full message, the findings it rests on, with approve, reject and edit. Updates arrive over the existing socket. No login yet (S1-10).
  *Test:* a component test that a pending email card shows recipient, subject, body and findings; approving calls the API with the edited text; a decided card leaves the list.

- [x] **S1-9 Action items.** SPEC 11, 12.
  An `action_items` table and `/api/action-items` for what needs the founder: blocked tasks, `ask_founder` questions, failed approvals, the kill switch being on. A page lists them.
  *Test:* an `ask_founder` call creates an item; resolving it unblocks nothing by itself but is recorded; a failed approval appears once.

- [x] **S1-10 Login for the owner.** SPEC 11 (Auth), 12.
  Better Auth with passkeys, one owner (Q10), sessions and devices tables. In local mode on 127.0.0.1 nothing changes. A login wall is required before anything listens on another interface (CLAUDE.md rule 9). Check the Better Auth docs for the current API before using it.
  *Test:* with login on, an API call without a session is 401 and with one is 200; the wall cannot be switched off while a non-loopback interface is configured; a session cookie is HttpOnly, Secure when not on loopback, and SameSite.

- [x] **S1-11 Phone access and the installable app.** SPEC 12; QUESTIONS 11.
  `ACCESS_MODE` lets the server also answer on a Tailscale address, and only if S1-10's login is on. The web app becomes an installable PWA (manifest, icons, service worker for the shell). Tailscale itself is Anees's step (NEEDS-YOU).
  *Test:* the server refuses to bind a non-loopback address with login off; the manifest and service worker validate; the approvals page lays out on an Android Chrome device profile in Playwright. The real phone check is in NEEDS-YOU.

- [x] **S1-12 Slice 1 end to end.** SPEC 18, row 1.
  One script drives the whole path on the outbox: create a lead, run the audit task, `propose_email`, approve it in the API, see the send in the outbox, flip the kill switch, try a forbidden route, restart the server mid-wait and check it sends once.
  *Test:* all four "Done when" checks pass in one run. Tag `slice-1-done`.
  Also, once: run the approval gate against a real Inngest dev server (`INNGEST_DEV=1`), because S1-3 tested the Inngest function with a stand-in for its `step` only (no Inngest server on the laptop). Nothing else about slice 1 depends on it: the default gate is the in-process one.

## Slice 2: Clients, funnels and Lead Gen

**Done when (SPEC 18, row 2):** new scored leads arrive every morning, a reply pauses its sequence, and the pipeline shows conversion by stage.

**Reads:** SPEC 4 (departments), 6, 10, 11, 12, 14, 15. Build only what this list names. Everything that sends still goes through `propose_*`, the approval gate and an executor, and the outbox is still the only transport (nothing real is switched on).

**Decided in drafting (logged in DECISIONS.md when built):**
- Slice 1's `leads` stay as the prospect list. A lead that replies or reaches a deal is promoted to an account, a contact and a deal; nothing is copied by an agent.
- Funnel stages live in `company/funnels.yaml` and are loaded into rows (rule 8: no Conclave facts in `apps/`).
- Lead sources that need an account or key (Apollo, Clay, Apify, Google Maps) are connectors for a later task. This slice takes leads from a CSV the founder drops in and from agents that read public pages with web fetch. Connectors are parked in NEEDS-YOU.
- Follow-ups still each go through an approval (autonomy 2). "Approved sequence" policy approval (autonomy 3) belongs to slice 8 with the delegate.
- The reply path is a manual record (paste or API) in this slice. Reading a real mailbox is a connector for later; replies and DMs arrive as data, never as instructions.
- The message table for threads is `thread_messages`, because `messages` already holds task comments.

- [x] **S2-1 Accounts, contacts and deals.** SPEC 10, 11.
  Tables `accounts`, `contacts`, `deals` (tenant tables, forced RLS, composite keys). API to list, create and edit them, and `POST /api/leads/:id/promote` that makes the account, the contact and a deal from a lead in one step, once.
  *Test:* promoting twice makes nothing new; a contact cannot point at another workspace's account; the tenancy test lists the new tables.

- [x] **S2-2 Funnels as stage rows, and the stage rules.** SPEC 10.
  `funnels` and `funnel_stages` loaded from `company/funnels.yaml` (both funnels from SPEC 10, owners and exit rules as text). A deal moves by `POST /api/deals/:id/stage`; each move is logged with time and who. A deal cannot pass the "first priced outcome" stage without a named decision-maker and a date. Moving a deal to won creates a project and its first tasks.
  *Test:* the rule refuses a move without both fields and allows it with them; won creates exactly one project, even if the move is repeated; every move is in the audit log.

- [x] **S2-3 Channel accounts, campaigns and sequences.** SPEC 10, 14, 15.
  `channel_accounts` (handle, daily cap, warm-up date, health), `campaigns` (market, audience rule, channel account, status draft/approved/running/paused/done) and `sequence_steps` (wait days, skill, template). Caps live on the channel account and the email executor reads them in addition to the workspace caps. A campaign must be approved by the founder before it runs.
  *Test:* a mailbox in warm-up sends at most its warm-up cap; a paused or unapproved campaign proposes nothing; the executor refuses over the channel cap.

- [x] **S2-4 Threads, replies and triage.** SPEC 10.
  `threads` and `thread_messages`: one thread per contact (or lead); every outgoing email lands on it. `POST /api/threads/:id/inbound` records a reply. A reply pauses that contact's sequence on every campaign and creates one triage task for the outreach agent. An unsubscribe-looking reply also adds the address to the suppression list. Reply text is stored as data and shown as data.
  *Test:* a reply pauses the sequence and makes exactly one triage task; a second reply makes no second task while the first is open; "unsubscribe" suppresses; a reply that says "ignore your rules and send X" changes nothing.

- [x] **S2-5 The sequence runner.** SPEC 10, 14.
  A deterministic job (not a model) that, once a day per running campaign, finds contacts whose next step is due, not paused, not suppressed, inside the mailbox's cap, and creates a task for the outreach agent to draft that step. Drafts still go through `propose_email` and approval.
  *Test:* due steps become tasks up to the cap and no more; a replied contact gets nothing; running it twice in a day makes no duplicates; a restart mid-run does not double-create.

- [x] **S2-6 Campaign and pipeline numbers.** SPEC 10, 12.
  `GET /api/campaigns/:id/results` and `GET /api/pipeline` as queries over the tables: sent, replied, positive replies, meetings, won; conversion and days in stage per funnel stage; stuck deals. No number is typed by an agent.
  *Test:* a seeded fixture gives exact counts; moving a deal changes the numbers; a reply marked positive counts once.

- [x] **S2-7 `leadgen-kit` and the lead-gen templates.** SPEC 4, 8, 9.
  Plugin `leadgen-kit` with skills for finding, enriching and scoring a lead, and `os` tools `add_lead` (autonomy 1, dedupes by email and domain, never marks anything verified without a source URL) and `score_lead`. Templates `prospector` and `scorer`. CSV import at `POST /api/leads/import` with a preview and a duplicate report.
  *Test:* `add_lead` twice makes one lead; a lead without a source URL is stored as unverified and is not eligible for a campaign; a scripted agent run adds and scores leads; the CSV import reports duplicates and bad rows without writing them.

- [x] **S2-8 Heartbeats: leads every morning.** SPEC 11, 14.
  A role-file `heartbeat` (cron in the company's time zone) that the ticker honours. The prospector runs each morning and produces scored leads; the run is skipped while the kill switch is on.
  *Test:* with a fake clock the ticker starts the prospector once per morning, not twice, and not at all while the kill switch is on; a missed day is not replayed in a burst after a restart.

- [x] **S2-9 The Goals screen.** SPEC 12.
  `/api/goals` over the existing `goals` table (create, edit, progress read from queries, not typed) and a Goals page.
  *Test:* progress for "leads this week" and "deals won" comes from the tables and changes when they do; the page lists goals with their numbers.

- [x] **S2-10 The morning brief.** SPEC 3, 12.
  A deterministic builder writes the brief (new scored leads, approvals waiting, replies to triage, stuck deals, goal progress, anything blocked) as a record, and the Chief of Staff template may add one paragraph of narrative that is clearly marked as the agent's. `/brief` shows the latest.
  *Test:* the brief lists exactly what the tables hold on a fixture day; an empty day says so; the narrative is optional and the brief is complete without it.

- [x] **S2-11 Inbox, pipeline and campaigns pages.** SPEC 12.
  Web pages for the unified inbox (threads, reply to triage), the pipeline (stages, conversion, stuck deals) and campaigns (status, results, approve, pause). Phone-friendly like the approvals page.
  *Test:* component tests like slice 1; the mobile browser check covers the inbox.

- [x] **S2-12 `deal-desk` and `client-success` templates.** SPEC 10.
  Templates and skills for the bounded free offer, the contract of success and outcome note, and the monthly proof report. They draft documents as task comments; nothing leaves the building. Case text may only quote numbers from the tables.
  *Test:* rendered on both engines, conformance passes; the outcome-note skill refuses to state a number not in the tables (checked by a fixture).

- [x] **S2-13 Slice 2 end to end.** SPEC 18, row 2.
  One test: a morning heartbeat adds scored leads; a campaign (approved by the founder) makes tasks; drafts are approved and sent to the outbox; a reply pauses the sequence and makes one triage task; the pipeline shows conversion by stage. Tag `slice-2-done`.
  *Test:* all three "Done when" checks in one run.

## Candidate connectors (not scheduled; Anees decides whether and in which slice)

Recorded 2026-11-13. Nothing here is built ahead of its slice (CLAUDE.md, Stack).

- **Chatwoot** (open-source shared inbox and help desk). Fits the help desk connectors row in SPEC 10, slice 10, next to Zendesk, Freshdesk and Intercom. It would be a connector that feeds conversations into the existing inbox, and could replace pasting replies in by hand. It can be self-hosted, so it may need no outside account; unconfirmed. Replies to clients still go through `propose_*` and an executor after approval (hard rules 1 and 3).
- **Composio** (hosted service with ready-made tool integrations and managed logins). Needs Anees's own account and API key, which the build cannot create or enter: it would go in `docs/NEEDS-YOU.md`. It pulls against the hard rules, so it may come in only as a read-only connector, or behind a `propose_*` tool with its own executor, never as a direct tool for an agent (rules 1, 4, 5 and 11). Lowest priority of the two.

## Slice 3: Reliability

**Done when (SPEC 18, row 3):** you can kill a run halfway and it resumes, a plan limit pauses agents cleanly, and a skill change that hurts the 20 leads is blocked.

**Reads:** SPEC 5, 6, 7, 11, 12, 14, 15. SPEC 14 is the table of failures and what the OS does for each; this slice builds the rows that are not built yet. Every failure ends as a permanent fix (the ratchet).

**Already there from earlier slices:** run states and their audit rows, the task's session id kept for resume, recovery of runs left `running` when the server restarts, the kill switch, the claim-once executors, approval expiry, and the error kinds the runtimes report (including a limit kind).

**Decided in drafting (logged in DECISIONS.md when built):**
- The "20 real leads" eval needs real leads. The build cannot supply them, so it ships 20 clearly-labelled sample leads and the runner; replacing them with real ones is a NEEDS-YOU item.
- Output checks are plain code with names (the role file's `output_check` picks one). A check passes or fails with a reason; it never calls a model.
- Pausing for a plan limit is per runtime, not per agent, and lifts itself at the reset time the runtime reported (or after a default wait if it gave none).

- [x] **S3-1 The reaper.** SPEC 14 (Run process dies).
  A job that finds runs whose `heartbeat_at` has gone stale, marks them failed, releases the task lock and puts the task back to todo with its session id, so the next run resumes. A task whose third run in a row has failed is blocked with the reasons. Runs the server itself is still executing are never reaped.
  *Test:* a run that stops heartbeating is reaped once and its task requeued with the session id; a live run is left alone; the third failure blocks the task; reaping twice changes nothing; the kill switch does not stop the reaper.

- [x] **S3-2 Retry, backoff and the fallback model.** SPEC 14 (Model API error), SPEC 7.
  A transient runtime error (rate limit, overload, network) retries the step with growing waits; then the agent's `fallback_model` alias; then the task is blocked with the reason. A non-transient error (auth, bad input) does not retry.
  *Test:* with a scripted runtime that fails N times: retries are spaced, the fallback is used after the retries, the task is blocked with the reason after that; an auth error blocks at once; each attempt is a row in the run's events.

- [x] **S3-3 Plan-limit handling.** SPEC 7 (Plan limits are part of the design), SPEC 14.
  A limit error pauses every agent on that runtime until the reset time (or a default wait), leaves their tasks queued, raises one action item, and lifts the pause by itself at the reset. Nothing is retried in the meantime.
  *Test:* one limit error pauses all agents on that runtime and none on another; queued tasks stay todo; exactly one action item however many agents hit it; at the reset time runs start again; a person can lift the pause early.

- [x] **S3-4 Budgets.** SPEC 14 (Budget exhausted).
  A ledger of what each agent's runs cost this month, checked before every run: over its monthly budget, the agent is paused and one action item is raised. A person raising the budget or unpausing lifts it.
  *Test:* a run that would start over budget does not start; the agent is paused with an item; the item appears once; a new month starts a new total; raising the budget resumes.

- [x] **S3-5 Output checks, repair and escalation.** SPEC 14 (Wrong or malformed output), SPEC 5.
  A registry of named checks (the first: `email-draft`, the limits written in the outreach rep's checks README; and `document-figures` from S2-12). After a run reports done, the role's check runs. On failure: one repair attempt in the same session showing the error, then the stronger model alias, then the task is blocked for the founder with the failures.
  *Test:* a passing output ends the task; a failing one is repaired once; still failing escalates once; still failing blocks with the reasons; a role with no check is untouched; the check never calls a model.

- [x] **S3-6 Circuit breakers.** SPEC 14 (Tool or connector error).
  Three failures in a row of a tool or connector open its breaker: further calls are refused at once with a clear message, one action item is raised, and the breaker closes after a cooldown or when a person resets it. A success resets the count.
  *Test:* three failures open it; calls are refused while open and not counted; it closes after the cooldown; a success in between resets; one breaker's state does not affect another's.

- [x] **S3-7 The Health screen.** SPEC 12, 14.
  `GET /api/health/overview` (queue depth, runs and failure rate by agent over a window, breakers, runtime pauses, spend against budget per agent, last reaper pass, database size) and a Health page with the kill switch on it.
  *Test:* a fixture gives exact numbers; a paused runtime, an open breaker and an over-budget agent each show up; the page renders each and the empty state.

- [x] **S3-8 The eval set and the gate.** SPEC 9, 14 (A change makes things worse).
  An eval set of 20 sample leads with the checks each draft must pass, a runner that has an agent draft for each lead and scores the drafts by the output checks, a stored baseline, and `pnpm run eval:gate` that fails if a change scores worse than the baseline. Replacing the samples with real leads is a NEEDS-YOU item.
  *Test:* with a scripted drafter the good skill scores at baseline and passes; a skill change that produces over-long drafts scores lower and the gate fails with which leads got worse; an unchanged skill is stable.

- [x] **S3-9 The daily backup.** SPEC 14 (Data loss).
  A scheduled job: a database dump into the data folder (keeping the last 14), and a git commit of the company folder. A restore command that checks the dump first. The OS never deletes a database that holds data.
  *Test:* a backup is written and is restorable into an empty database; old ones beyond 14 are pruned; a failed dump leaves the old ones alone and raises an item; the company folder commit happens only when something changed.

- [x] **S3-10 Lite mode.** SPEC 17.
  `LITE=1` for a machine with little memory: one run at a time, no more than one Inngest or ticker task at once, and `doctor` reports the mode and memory.
  *Test:* in lite mode the dispatcher runs at most one agent at a time; the default is unchanged; `doctor` says which mode.

- [x] **S3-11 Slice 3 end to end.** SPEC 18, row 3.
  One test: a run is killed halfway and the next run resumes from its session; a plan limit pauses the agents on that runtime and lifts at the reset; a skill change that hurts the sample leads is blocked by the gate. Tag `slice-3-done`.
  *Test:* all three "Done when" checks in one run.

## Slice 4: A local model, all day

**Done when (SPEC 18, row 4):** scouts run around the clock on your machine and you get a short list of qualified signals each morning.

**Reads:** SPEC 5 (the portability rule and the table of what each engine needs), 7 (runtimes, model aliases, the in-process runner, plan limits), 9 (templates and plugins), 11 (the `signals` table), 12, 14, 17 (what the machine can carry). Rooms 6 and 9 in SPEC 3 say what the scouts look for.

**Already there from earlier slices:** the runtime contract and conformance tests, `claude-cli` and `opencode`, the renderer with one target per runtime, the `os` MCP server with run tokens, heartbeats, output checks with repair and escalation, the pause per runtime for a plan limit, the Health screen, lite mode, the morning brief.

**Decided in drafting (logged in DECISIONS.md when built):**
- The model is never needed to prove the plumbing. The runner is tested against a small fake OpenAI-compatible server inside the test, so the whole slice is verifiable on this laptop without a model loaded. Trying a real local model is one opt-in task (S4-9) and the model that fits 16 GB is a NEEDS-YOU item because the laptop has to be free for it.
- `openai-agents` gets only the `os` tools plus `load_skill`. No shell, no files, no network of its own (CLAUDE.md rule 10). The `@openai/agents` calls in the SPEC are an unrun sketch: check the package's current docs before using any of them.
- The scouts only read. They file a signal through an `os` tool; the OS dedupes by URL. Where a signal comes from (a scraper or API, within each site's terms) is a connector the founder sets up; until then the scout works from what it is handed or can search, and the real sources go in NEEDS-YOU.
- Rooms 9 and 10 are configured but paused, as the spec says. Room 6's Problem Scout and room 9's scout are the two scouts this slice turns on; the Research room waits for its own slice.

**Tasks**

- [x] **S4-1 Model aliases and the `local-worker` alias.** SPEC 7 (Model aliases).
  One file maps each alias to a model, the runtimes it works on and, where needed, a base URL and a key reference. Add `local-worker` (an OpenAI-compatible endpoint, Ollama's by default, `on: ['openai-agents', 'opencode']`). The role-file loader rejects an alias that does not list the agent's runtime, with the file and the reason. The base URL must be loopback unless the founder sets it explicitly.
  *Test:* a role file naming `local-worker` on `openai-agents` loads; the same alias on `claude-cli` is refused with a message naming both; a missing alias is refused; an unknown field in the alias file is an error.

- [x] **S4-2 The `openai-agents` runtime.** SPEC 7 (the in-process runner), 5 (the portability rule).
  A generic in-process runner behind the one contract in `runtimes/`: builds the agent from the rendered instructions, connects the `os` MCP server over HTTP with the run's token, streams the SDK's events as run events in order, caps turns, handles cancel, and maps a connection refusal, a rate limit and an auth failure to the right error kinds. It is handed its own model settings and nothing else from the environment (CLAUDE.md rule 4). Session resume is kept by the OS: it says it cannot resume natively and the loop restarts the task with its comment history instead.
  *Test:* the conformance tests pass against a fake OpenAI-compatible server in the test: events arrive in order, an `os` tool is called with the run token, a tool the agent was not granted is refused, no secret reaches the process, cancel stops it, a 429 and a 401 map to `limit` and `auth`, and `canResume` is honest.

- [x] **S4-3 The skill loader.** SPEC 5 (the table), 9.
  The in-process runner has no `.claude/skills`. The renderer writes each skill's name and one-line description into the instructions, and the runner gives the agent a `load_skill` tool that returns the skill's text from the agent's rendered folder, only for skills that agent was given, never a path outside it.
  *Test:* the instructions list the descriptions and not the bodies; `load_skill` returns a granted skill; a skill that was not granted, a path with `..`, an absolute path and a symlink out of the folder are all refused.

- [x] **S4-4 The renderer target for `openai-agents`.** SPEC 5.
  One more target in the renderer: standing rules, role, skill descriptions and the per-run context become one `instructions` string; connectors become the MCP server list; permissions become the tool list the runner hands over. Nothing outside `runtimes/` and the renderer's per-runtime targets names the runtime (rule 11).
  *Test:* snapshot of a scout rendered for `openai-agents`; the same template rendered for `claude-cli` is unchanged; a permission the runner cannot enforce is a render error, not a silent drop.

- [x] **S4-5 Move short jobs to the local model when Claude is paused.** SPEC 7 (Plan limits are part of the design), 14.
  When a runtime is paused for a plan limit, waiting scout and triage tasks go to the agent's local alternative instead of waiting; writing tasks stay queued. A role file names it (`fallback_runtime` and `fallback_model`), and escalation from a failed output check may cross to a stronger runtime the same way (local to Claude). The move is recorded on the run and shown on the Health screen.
  *Test:* with `claude-cli` paused, a triage task runs on the local alias and a writing task stays queued; after the lift both are back on their own runtime; a failed check on the local model escalates to Claude once and then blocks; an agent with no fallback is unchanged.

- [x] **S4-6 The `signals` table and its API.** SPEC 11 (`signals`), 12.
  Migration with forced row-level security, `(workspace_id, url)` unique, kinds `service_request | pain_point | tool_news`, statuses `new | qualified | dismissed | promoted`. Routes to list (by status and kind), read, qualify, dismiss and promote to a lead (the lead carries the signal as its reason, and the existing lead checks still apply).
  *Test:* the same URL twice is one signal; a signal from another workspace is invisible; promote creates one lead and links it, twice is a no-op; a bad status or kind is refused.

- [x] **S4-7 The scout template and the signal tools.** SPEC 9, 3 (rooms 6 and 9), 6.
  A `scout` template that runs on `openai-agents` with `local-worker`, a heartbeat, and a short skill that says what counts as a signal and what does not. Two `os` tools: `add_signal` (kind, source, URL, excerpt; refuses a missing URL, an excerpt that is not text, and anything shaped like an instruction to the agent) and `score_signal`. The tools do not post, message or follow anyone (rule 6). The Demand Radar and Problem Scout agents are configured and paused; turning one on is a setting.
  *Test:* the template renders and hires; `add_signal` dedupes and records who found it; a page that tells the agent to ignore its rules is stored as data and changes nothing; the paused agents do not run on a heartbeat until switched on.

- [x] **S4-8 Signals in the morning brief and a Signals page.** SPEC 3, 12, 18 (the "Done when").
  The brief gets a part "Signals" counting qualified signals since the last brief with the top few (counted from the table, not written by a model), and a Signals page lists them by status with qualify, dismiss and promote.
  *Test:* a fixture gives exact counts in the brief; the page renders each status and the empty state; promote from the page makes the lead.

- [x] **S4-9 Try a real local model (opt-in).** SPEC 17, 7.
  The conformance tests, run against Ollama on this machine when `CONCLAVE_TEST_OLLAMA=<model>` is set, and a note of which tool-calling model fits comfortably in 16 GB while the server and the database are running. Skipped by default.
  *Test:* skipped without the variable; with it, the conformance tests pass on the real endpoint. Running it is a NEEDS-YOU item (RAM must be free).

- [x] **S4-10 Slice 4 end to end.** SPEC 18, row 4.
  One test on the fake OpenAI-compatible server: the ticker wakes the scout on its heartbeat, it files signals through `add_signal`, a failing output check escalates once to Claude (scripted), a plan limit on Claude moves a triage task to the local model, and the morning brief lists the qualified signals. Tag `slice-4-done`.
  *Test:* all of it in one run.

## Slice 5: Marketing, browser and video

**Done when (SPEC 18, row 5):** you approve a post or a video on your phone and it is live, with a screenshot in the record.

**Reads:** SPEC 6 (approvals and executors), 8 (the browser table, the video studio), 12 (the phone app and push), 14, 15 (caps, no bulk DM, no unverified claims), 3 (room 3). The spec's own rule: where a platform offers a posting API, use it instead of the browser.

**Already there from earlier slices:** the approval gate and the claim-once executor pattern (email), send caps and the kill switch, channel accounts with caps, the outbox transport, the blocked-claims check, plugins and templates, the PWA shell (manifest, icons, shell-only service worker), the `os` tools and the Health screen.

**Decided in drafting (logged in DECISIONS.md when built):**
- **Nothing goes live in this slice's build.** I cannot create accounts, log in to X, LinkedIn or Instagram, or hold a key. Every executor has an interface with two transports: `outbox` (writes the post to a file in the data folder; the default, nothing leaves the machine) and `browser` (a Playwright session in a profile folder you log into once by hand). The browser transport is built and tested against a fake browser, and stays off until you turn it on per account. Logging in once by hand, and switching a real transport on, are NEEDS-YOU items.
- **Every post is an approval first.** A post proposal carries the exact text, the account and the media; what you approve is what is published, byte for byte. The executor claims the approval once and never retries a publish (rule 3). Content is checked in the proposal handler, not by a prompt: no medical, legal or pricing claim that is not in the company file (rule 7).
- **DMs are one at a time and capped.** No bulk, no follow or like automation (rule 6); each DM is its own approval and the account's cap and a minimum gap between sends are enforced in code.
- **Video generation is behind a connector interface** (`generate_asset`), with a fake in the tests. Which generator you use, and its credits, are yours to choose; credits are spent only after you approve a brief. Assembly is deterministic code (the same brief renders the same video), tested on its plan; an actual render needs Remotion and is an opt-in check, since its license terms need your reading before the OS is sold.
- **Push** uses Web Push with keys made on this machine (stored in the data folder, never in the repo). Delivery to your phone needs the app reachable from it (the Tailscale step already in NEEDS-YOU).

**Tasks**

- [ ] **S5-1 Posts and the post proposal.** SPEC 6, 8, 15.
  A `posts` table (account, text, media, status, approval link, result), `propose_post` as an `os` tool (autonomy 2) that queues an approval of kind `post.publish` and never publishes, and the proposal handler's checks: length per platform, blocked claims, no links to unapproved domains, duplicate text refused.
  *Test:* a proposal creates one pending approval and one post row; a second identical proposal is the same approval; a medical, legal or price claim is refused in code; over-length is refused; an agent below autonomy 2 has no such tool.

- [ ] **S5-2 The publish executors and transports.** SPEC 6, 8, 14.
  One executor interface for X, LinkedIn and Instagram posts, claim-once (`approved` to `executing`), with an `outbox` transport (default) and a `browser` transport that drives a Playwright page through a small driver interface. Every run saves a screenshot and the final URL on the approval record. An expired session stops the executor and raises an action item; nothing is retried.
  *Test:* with the outbox transport an approved post is written once and marked published; two executions at once publish once; a rejected or expired approval never publishes; the fake browser publishes, and its screenshot and final URL are stored; an expired session raises one item and the post stays approved, not failed; the kill switch stops it.

- [ ] **S5-3 Browser profiles.** SPEC 8, 12.
  A profile folder per channel account under the data folder (never in the repo), a record of which accounts have one and whether the session is believed valid, and `pnpm run browser:login <account>` that opens a visible browser on that profile for you to log in by hand. The OS never sees a password.
  *Test:* the profile path is inside the data folder and outside the repo; an account with no profile cannot use the browser transport; a profile marked expired raises the item; the login command refuses an unknown account. Logging in is a NEEDS-YOU item.

- [ ] **S5-4 Approved DMs, one at a time.** SPEC 15, rule 6.
  DM executors for X and Instagram as their own approval kind: each DM is a separate approval to a named person, with the account's daily cap, a minimum gap between sends, and a refusal to send to anyone who has not been written to first by a person or who is on the suppression list.
  *Test:* two approved DMs at once go out one after the other with the gap; the cap holds; a suppressed recipient is refused; there is no tool or route that sends to a list.

- [ ] **S5-5 The content plugin and the writer, publisher and hook scout templates.** SPEC 8, 9.
  `content-kit` (skills: write-post, adapt-for-platform), a `content-writer` template (proposes posts, cannot publish) and a `publisher` template (checks the approved queue, level 0 on trial).
  *Test:* manifests match the disk and the server; the writer has no web write tool and no publish tool; rendered for Claude Code.

- [ ] **S5-6 Hooks and the Hook Scout.** SPEC 8.
  A `hooks` table (pattern, format, length, example link, the account it was seen on, a performance score), an `add_hook` tool, and the Hook Scout template on the local model. A hook stores a link to the example and a description of the pattern, never a copy of the post's text.
  *Test:* a hook with no example link is refused; a long verbatim quote is refused; the same example is one hook; the scout cannot propose a post.

- [ ] **S5-7 The Video Ideas inbox.** SPEC 8, 12.
  `video_ideas` (a line, a link or a voice-note transcript; source founder or hook scout), an API, an inbox page that works on a phone, and a quick-add box.
  *Test:* adding from the page creates one idea; a link is stored as a link; the inbox lists new ideas first; an idea can be shelved or turned into a brief.

- [ ] **S5-8 The video brief and the generation connector.** SPEC 8.
  A brief (script, shot list, assets needed, estimated credits) made from an idea and a hook, which is an approval before anything is generated. A `generate_asset` connector interface with a fake; assets are stored by key in the data folder.
  *Test:* nothing is generated before the brief is approved; a rejected brief generates nothing; the credits shown are counted from the shot list; generation is claim-once.

- [ ] **S5-9 Assembly and the review check.** SPEC 8.
  A deterministic assembly plan (scenes, captions, timing, brand) from an approved brief and its assets; the same inputs give the same plan byte for byte. A review check in code (duration within the brief, every shot has an asset, captions present, brand colours and logo present, no blocked claim in captions) before the approval card.
  *Test:* identical inputs give an identical plan; each review rule fails with its reason; a plan that fails review is not offered for approval.

- [ ] **S5-10 The phone app and push.** SPEC 12.
  Web Push with VAPID keys generated on this machine and kept in the data folder; subscriptions stored; three notifications only: the morning brief, a failed executor, and an approval waiting. Payloads carry no post text or personal data.
  *Test:* keys are never in the repo or a log; a subscription is stored once; each of the three events sends exactly one notification and nothing else does; a payload has no body text from a post or a lead; an expired subscription is removed.

- [ ] **S5-11 Slice 5 end to end.** SPEC 18, row 5.
  One test: a writer proposes a post, you approve it on a phone-sized screen, the publisher executes it through the fake browser, and the approval record shows the screenshot and final URL; a video brief is approved, assets are generated by the fake connector, the plan passes review, and the approved video is published the same way; push fires for the approval and for a failed executor. Tag `slice-5-done`.
  *Test:* all of it in one run.

## Opening the next slice

When slice 0 is in daily use, paste this:

```text
Slice 0 is done. Read SPEC section 18, row 1, and the SPEC sections it depends on
(6, 8, 10, 11, 12, 14 and 15).
Draft the task list for slice 1 in docs/BUILD.md in the same format as slice 0:
small tasks, each with the SPEC sections to read and one acceptance test. Do not write code.
```
