# Build plan

The spec is `docs/SPEC.md`. Section 18 lists ten slices. Only one slice is open at a time.

## Current slice: 0, Skeleton

**Done when:** one agent made from a template takes a task and runs on the signed-in Claude Code CLI, the same template runs on OpenCode after a one-line change to its role file, every step of the run is readable on a plain web page, and `pnpm doctor` prints memory use.

**Stop rule:** do not open slice 1 until slice 0 is something you use.

**Why two engines in slice 0:** the OS must not depend on one harness or one model (SPEC 5, the portability rule). Two runtimes passing the same conformance tests prove that before anything is built on top.

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

- [ ] **S0-1 Monorepo scaffold.** SPEC 13.
  pnpm workspace with `apps/server` (Hono), `apps/web` (Next.js), `packages/shared` (Zod schemas), `packages/cli`, TypeScript, ESLint and Vitest. Both apps listen on 127.0.0.1 only.
  *Test:* `pnpm test` passes a server health check, and `pnpm dev` starts the server and the web app.

- [ ] **S0-2 Database and tenancy.** SPEC 11, the "tenancy rule" and the slice 0 SQL block only.
  Embedded Postgres that starts with the server and keeps its files under `DATA_DIR`. Drizzle schema and migrations for the twelve slice 0 tables exactly as that block gives them. The server connects as a non-superuser role that does not own the tables, row-level security is enabled and forced, and each request sets `app.workspace_id` in its transaction. Do not create the vector extension. On first start, create one workspace in local mode.
  *Test:* a query made as workspace A cannot read a row that belongs to workspace B, and a query with no workspace set returns no rows.

- [ ] **S0-3 Company folder loader.** SPEC 5 (role file), 7 (model aliases), 13.
  Read `company/COMPANY.md`, `company/goals.yaml`, `company/departments.yaml` and every `company/departments/<dept>/agents/<id>/AGENT.md`. Validate with Zod. Sync departments, agents and goals to the database by `key`. The role file is the source of truth for its front matter. `config/models.ts` maps each alias to a model and the runtimes it works on.
  *Test:* the starter `company/` folder loads eleven departments and three ladder goals. A role file with an unknown `runtime` is rejected with a clear message, and so is one whose model alias does not list its runtime.

- [ ] **S0-4 Template renderer with two targets.** SPEC 5 (templates, default permissions, how grants reach a CLI, the portability rule).
  Three templates in `templates/agents`: `lead`, `researcher`, `writer`. Each holds neutral sources only: `template.yaml`, `AGENT.md.hbs`, `RULES.md.hbs`, `permissions.yaml`, `connectors.yaml` and `skills/`. `render(template, params)` writes `AGENT.md` to `company/departments/<dept>/agents/<id>/`, and writes the working folder under `DATA_DIR` for the agent's runtime. The `claude-cli` target writes `CLAUDE.md`, `.claude/settings.json`, `.claude/skills` and `.mcp.json`. The `opencode` target writes `AGENTS.md`, an agent file in `.opencode/agents/`, `opencode.json` and the same `.claude/skills` folder. Check OpenCode's current docs for its config shape before writing that target. Default permissions give no shell and no network-writing tool on either target. Add `pnpm agent:new <template> --department <key>`, which renders and registers the agent as `active` at autonomy 0 (slice 0 has no approvals inbox yet).
  *Test:* a snapshot of the rendered `writer` for each target. A missing required parameter fails. The working folder is not inside the repo. Neither rendered folder grants a shell.

- [ ] **S0-5 The `os` MCP server.** SPEC 6 ("How a CLI agent reaches these tools"), 8.
  An HTTP MCP endpoint on the server, bound to 127.0.0.1, with `get_task`, `comment`, `complete_task`, `block_task` and `ask_founder`. Each call carries a per-run token that the server resolves to workspace, agent, run and task. The agent does not check tasks out; the run loop does (S0-8).
  *Test:* a call with no token is refused, and a call with another run's token cannot touch this run's task.

- [ ] **S0-6 CLI runtime, two engines.** SPEC 5 (the runner, "Three things this runner must get right", "One trap per engine"), 7.
  `runtimes/types.ts` and `runtimes/cli.ts` for `claude-cli` and `opencode`. Before each run, write the per-run token into the agent's connector config. Spawn the CLI headless in the agent's working folder with a clean environment. Turn its JSON lines into run events, store them, capture the session id, and classify a plan-limit or sign-in message as its own error kind. Run `claude --help` and `opencode run --help` first and use the real flags, not the ones in the spec sketch. Nothing outside `runtimes/` and the renderer targets may name a harness.
  *Test:* with a fake `claude` script that prints canned JSON lines, the events are stored in order and the run ends `succeeded`. A second fake that exits non-zero ends `failed`. A third that prints a plan-limit line ends `failed` with kind `limit`. The same three cases pass with a fake `opencode`. The child's environment holds no variable from `.env` except those in the model alias.

- [ ] **S0-7 Runtime conformance tests.** SPEC 5 (the portability rule, rule 3).
  `runtimes/conformance.ts`: one test suite that takes any `Runtime` and checks the seven points in rule 3. Run it against `claude-cli` and `opencode` using the fake binaries. Later runtimes must pass the same suite before an agent may use them.
  *Test:* both runtimes pass. A deliberately broken runtime that leaks an environment variable fails with a message naming the variable.

- [ ] **S0-8 Run loop and ticker.** SPEC 5 (the eight steps), 11 ("One event starts every run"), 14 (limits).
  An Inngest function `agent-run`, triggered by `agent/run.requested`, with the two concurrency limits in SPEC 14. It checks in plain code whether the agent has a task before any model call, then checks the task out with the atomic update. `POST /agents/:id/run` sends the event. A `ticker` function on a one-minute cron sends it for agents whose `heartbeat_cron` is due. The loop picks the runtime from the agent's role file and never names one itself.
  *Test:* a run for an agent with no tasks makes no CLI call. Two run requests at the same moment never check out the same task.

- [ ] **S0-9 Plain task page.** SPEC 11 (API table), 12 (stack only).
  One web page: the task list, a form to create a task, and a live log of a run over a WebSocket, with its state, the runtime it ran on, and the cost estimate if the CLI reported one. No office canvas, no login (it only answers on 127.0.0.1).
  *Test:* a component test that a stored run's events render in order.

- [ ] **S0-10 `pnpm doctor`.** SPEC 17.
  Check Node and pnpm versions, that `claude` is on the path and signed in, that the database and Inngest are reachable, that the server is bound to 127.0.0.1, and that `DATA_DIR` is outside the repo. Report `opencode` as ready, not signed in, or missing; a missing `opencode` is a warning, not a failure. Print memory use of the server and database processes.
  *Test:* doctor exits non-zero and names the problem when `claude` is not on the path, and exits zero with a warning when only `opencode` is missing.

- [ ] **S0-11 End to end, on both engines.**
  Run `pnpm agent:new researcher --department research`. Give it the task "List five facts from the company file, each with the line it came from", with `company/COMPANY.md` passed in the task context. Fire a run. Then change the role file's `runtime` to `opencode` and its `model` to an alias that lists `opencode`, render again, and fire the same task.
  *Test, by hand:* both runs end `done`, each answer is in its task thread, every step is visible on the task page, and neither run log contains text from this repo's `CLAUDE.md`. If OpenCode is not installed or has no provider yet, record that in `docs/DECISIONS.md` and leave this box unticked until it is.

## Opening the next slice

When slice 0 is in daily use, paste this:

```text
Slice 0 is done. Read SPEC section 18, row 1, and the SPEC sections it depends on
(6, 8, 10, 11, 12, 14 and 15).
Draft the task list for slice 1 in docs/BUILD.md in the same format as slice 0:
small tasks, each with the SPEC sections to read and one acceptance test. Do not write code.
```
