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

- [ ] **S1-3 The gate workflow, and restart recovery.** SPEC 6 (how the gate is built, three rules), 11, 14.
  `approval-gate` on Inngest and its in-process equivalent, with the same behaviour: wait for the decision (3 day timeout marks it `expired`), then run the executor once. On server start, request again every `pending` approval that has no live wait. The execute step never retries.
  *Test:* an approval decided after a simulated restart sends exactly once; two executors racing for one approval send once; a pending approval left over from before a restart is picked up; an expired approval never sends.

- [ ] **S1-4 Leads and the suppression list.** SPEC 10, 15.
  `POST/GET/PATCH /api/leads` (create, list, one lead, stage and do-not-contact) and `GET/POST/DELETE /api/suppression`. Addresses are normalised and matched case-insensitively. An unsubscribe adds to the list and nothing removes it silently.
  *Test:* a lead marked do-not-contact is refused by `propose_email`; adding an address to the list blocks proposals for it in any case; removing needs an explicit call and is logged in `audit_log`.

- [ ] **S1-5 Settings, the kill switch and the send caps.** SPEC 6, 14, 15; QUESTIONS 9.
  `workspace_settings` holds the kill switch and the caps: `window_hours` = 5 and `window_cap` = 30 (a rolling window), plus a per-day cap. Follow-ups count in the same window. `GET/PATCH /api/settings`. With the kill switch on: no new run starts, running runs are cancelled, queued requests are dropped, and no executor sends, including approvals already approved.
  *Test:* the 31st email inside five hours is held and the 31st after the window moves is allowed; the kill switch stops a running fake run, empties the queue and blocks an executor on an already-approved email; turning it off does not resurrect dropped work.

- [ ] **S1-6 The `outreach-rep` template and `outreach-kit`.** SPEC 5 (templates, default permissions), 8, 10.
  A neutral template for the first-touch writer: role file, rules, `permissions.yaml` (the `os` tools only, no shell, no network write), a procedure skill for the first email, and an output check. `outreach-kit` carries the skill and the connector entry.
  *Test:* a snapshot of the rendered folder for both engines; neither grants a shell or a network-writing tool; through the conformance suite's `forbidden` mode, an attempt to send by any route other than `propose_email` is refused and nothing is sent.

- [ ] **S1-7 The email executor, wired.** SPEC 6, 14, 15.
  Register the executor with the gate in `index.ts`. Sending requires the footer address from `company/` and a transport; with no footer the approval ends `failed` with that reason and nothing is sent. The outbox is the default transport; Resend is selected only by an explicit setting. Every send records the outcome on `outreach_messages` and in `audit_log`.
  *Test:* an approved email lands in the outbox exactly once; with the footer unset the executor refuses and says why; a blocked claim added after approval is still refused at send time; the outbox is the transport unless the setting says otherwise.

- [ ] **S1-8 The approvals inbox page.** SPEC 12.
  A web page listing pending cards: for an email, the recipient, the full message, the findings it rests on, with approve, reject and edit. Updates arrive over the existing socket. No login yet (S1-10).
  *Test:* a component test that a pending email card shows recipient, subject, body and findings; approving calls the API with the edited text; a decided card leaves the list.

- [ ] **S1-9 Action items.** SPEC 11, 12.
  An `action_items` table and `/api/action-items` for what needs the founder: blocked tasks, `ask_founder` questions, failed approvals, the kill switch being on. A page lists them.
  *Test:* an `ask_founder` call creates an item; resolving it unblocks nothing by itself but is recorded; a failed approval appears once.

- [ ] **S1-10 Login for the owner.** SPEC 11 (Auth), 12.
  Better Auth with passkeys, one owner (Q10), sessions and devices tables. In local mode on 127.0.0.1 nothing changes. A login wall is required before anything listens on another interface (CLAUDE.md rule 9). Check the Better Auth docs for the current API before using it.
  *Test:* with login on, an API call without a session is 401 and with one is 200; the wall cannot be switched off while a non-loopback interface is configured; a session cookie is HttpOnly, Secure when not on loopback, and SameSite.

- [ ] **S1-11 Phone access and the installable app.** SPEC 12; QUESTIONS 11.
  `ACCESS_MODE` lets the server also answer on a Tailscale address, and only if S1-10's login is on. The web app becomes an installable PWA (manifest, icons, service worker for the shell). Tailscale itself is Anees's step (NEEDS-YOU).
  *Test:* the server refuses to bind a non-loopback address with login off; the manifest and service worker validate; the approvals page lays out on an Android Chrome device profile in Playwright. The real phone check is in NEEDS-YOU.

- [ ] **S1-12 Slice 1 end to end.** SPEC 18, row 1.
  One script drives the whole path on the outbox: create a lead, run the audit task, `propose_email`, approve it in the API, see the send in the outbox, flip the kill switch, try a forbidden route, restart the server mid-wait and check it sends once.
  *Test:* all four "Done when" checks pass in one run. Tag `slice-1-done`.

## Opening the next slice

When slice 0 is in daily use, paste this:

```text
Slice 0 is done. Read SPEC section 18, row 1, and the SPEC sections it depends on
(6, 8, 10, 11, 12, 14 and 15).
Draft the task list for slice 1 in docs/BUILD.md in the same format as slice 0:
small tasks, each with the SPEC sections to read and one acceptance test. Do not write code.
```
