# Decisions

Newest first. One entry per decision: what, why, and what it replaced.

## 2026-11-12 (S0-3 to S0-9, built overnight by Claude in the cloud on top of S0-2)

- **Built on this S0-2 as it stands.** The overnight session also wrote an S0-2 of its own while this one was still in progress. When this one landed, that copy was dropped and everything else was rebased onto it, because this one runs on Windows and fixes the Postgres shutdown.
- **The request transaction covers `/api/*` only.** The `/mcp` endpoint, the `/events` socket and Inngest open their own short transactions, because a run or a socket can stay open for minutes and would hold a pooled connection the whole time. Work that must wait for the commit, like starting a run for a task that was just inserted, goes in `c.get('after')`. The two middleware tests moved to `/api/_probe` and `/api/_boom`. Inngest is served at `/inngest`. SPEC 11.
- **The run token reaches the `os` server through an environment variable, never a file.** Claude Code expands `${CONCLAVE_RUN_TOKEN}` in `.mcp.json` and OpenCode expands `{env:CONCLAVE_RUN_TOKEN}` in `opencode.json`. Both were checked with the real binaries, and the token is redacted from every stored event. SPEC 6.
- **Prompts never go on a command line.** Claude Code reads the task on stdin, and OpenCode gets it as an attached file with a fixed message. This also makes a `.cmd` shim on Windows safe to start through a shell.
- **The agent environment is an allow-list:** `PATH`, `HOME`, `LANG`, plus the Windows profile variables `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `SYSTEMROOT`, `TEMP`, `TMP`, `PATHEXT` and `COMSPEC`, so a CLI can find its own sign-in on Windows. No server secret reaches an agent, and conformance point 4 checks that.
- **Claude Code file tools are scoped to the working folder:** `Read(./**)`, `Write(./**)`, `Edit(./**)`, with `Glob` and `Grep` denied and `--permission-mode dontAsk`. Why: a real run showed an agent globbing a folder in the home directory. After the change, a real run was refused `/etc/hostname` and allowed `ROLE.md`. OpenCode gets `external_directory: deny`. SPEC 5.
- **The OpenCode target is written for opencode 1.19.5,** checked with `opencode debug config`, `debug agent` and `debug skill`: `mcp.<name>` and a `permission` map in `opencode.json`, agents in `.opencode/agents/`, skills in `.opencode/skills/`. The docs site describes a newer "V2" shape that this binary does not use. Agent runs set `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` and `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`, because without them your personal `~/.claude/skills` loaded into a company agent (seen with the binary).
- **Claude Code 2.1.322 has no `--max-turns`,** so the runner counts turns and stops the run itself.
- **Workflows: Inngest when configured, else an in-process dispatcher with the same limits.** If `INNGEST_DEV`, `INNGEST_BASE_URL` or `INNGEST_EVENT_KEY` is set, `agent-run` (limit 2, one per agent) and `ticker` (every minute) run on Inngest. Otherwise the server runs the same limits in-process and ticks with a timer, so the OS works with nothing else installed. A failed run blocks its task with the reason and is not retried. SPEC 11, 14.
- **Heartbeat crons use the machine's local time,** so `0 9 * * 1-5` means 9am where you are.
- **Queries are raw SQL on `tx.client` for now.** The Drizzle schema from S0-2 is there for migrations and typed queries later.
- **`COMPANY_DIR` can point the server at another company folder.** The default is the repo's `company/`. It is used by tests and by the end-to-end smoke run, and later by a second company.
- **`@embedded-postgres/linux-x64` may run its install script** (the same symlink-only script as Windows). `protobufjs`, pulled in by Inngest, may not: its script only checks versions.
- **`pnpm run doctor`, not `pnpm doctor`.** pnpm 11 has a built-in `doctor` command that runs instead of the script. The server writes `DATA_DIR/server.pid` so doctor can report its memory.
- **S0-11 is a command, `pnpm run e2e`,** run against a running server. It hires the researcher if needed, runs the task on Claude Code, switches the role file to OpenCode, runs it again, checks that each answer is in the thread and that no run log holds text from this repo's `CLAUDE.md`, and restores the role file. `E2E_OPENCODE_MODEL` picks the OpenCode alias.
- **The agent `os` tools are `get_task`, `comment`, `complete_task`, `block_task` and `ask_founder`, over a stateless Streamable HTTP MCP endpoint** with no SSE stream. Real Claude Code and OpenCode both connected to it.

## 2026-11-12 (v6: client meetings and channels)

- **Client meeting room with video, on LiveKit.** Apache 2.0, separate from the OS server. Clients join by a one-meeting guest link. The OS itself never becomes public. SPEC 10, 12.
- **AI in client calls starts as note taker only.** A live AI speaker waits for a month of notes and passing mock-call evals, because nothing said live can be approved first. SPEC 10, 19.
- **Recording needs consent per call.** SPEC 10.
- **Slack, Jira, help desks, CRMs and calendars are connectors behind the approval gate.** One system of record per workspace, the OS by default. SPEC 10.
- **Room 19, Meetings Desk, and slice 10.** Booking and briefs start in slice 2. SPEC 4, 18.

## 2026-11-12 (S0-2: tenancy keys and policy)

- **Foreign keys cannot cross workspaces.** Every tenant table with an `id` gets `unique (workspace_id, id)`, and every foreign key between tenant tables is `(workspace_id, x_id) references t (workspace_id, id)`. Why: Postgres runs foreign key checks without row-level security, so a plain key lets a row in workspace A point at a row in workspace B. Cheap at schema birth, painful later. Goes beyond the original slice 0 block, so SPEC 11 was updated first. `members` has no `id`, so it keeps its plain key. `departments.lead_agent_id` gains a composite key too, added after `agents` exists. SPEC 11.
- **Policies use `nullif(current_setting('app.workspace_id', true), '')::uuid`.** On a pooled connection that has run `set_config(..., true)`, the setting reads as an empty string, not null, and a bare `''::uuid` raises an error instead of returning no rows. A test covers a one-connection pool. `workspaces` has no `workspace_id`, so its policy is on `id`. SPEC 11.
- **Three database roles.** The `initdb` superuser is used once at first start to create `conclave_owner` and `conclave_app`, then never again, and its password is not stored. The owner owns the tables and is used only for migrations and bootstrap. The app role serves requests with select, insert, update and delete only. If first start is interrupted before the credentials file exists, the half-made cluster holds no data and is wiped and made again. SPEC 11.
- **`conclave_owner` has `bypassrls`.** Under forced row-level security even the table owner sees no rows with no workspace set, so bootstrap could not ask "is there a local workspace yet?" or count workspaces. The owner is never on a request path (it is a short-lived connection for migrations and bootstrap), and the request role has no bypass. SPEC 11 says so.
- **No default privileges for the request role.** The grants migration names the twelve tables. A table added later is invisible to `conclave_app` until its own migration enables and forces row-level security, adds the policy and grants on it, and the tenancy test fails if a table skips that.
- **`pnpm db:migrate` starts the embedded database, applies migrations and stops.** The server applies the same migrations at every start. Checked by hand: a hard kill of the server's process tree leaves no Postgres behind, and the next start recovers.
- **Postgres is stopped with `pg_ctl stop -m fast`, not the library's `stop()`.** On Windows the library runs `taskkill /f /t` on the postmaster. That is a crash, not a shutdown, and it sometimes missed a child: a surviving `io_worker` was found after runs that passed, and in one loop of start, stop, wipe, restart the next start on the same directory hung (initdb's `--check` process stuck). The same path is Ctrl+C then restart of the real server. The fix keeps the same package and the same Postgres. Checked: ten rounds with zero Postgres processes left after every stop, three full test runs in a row, and a test that `postmaster.pid` is gone after a stop. If `pg_ctl` fails, it falls back to the library's kill. A start that goes wrong now fails with the last lines Postgres printed (the library rejects with `undefined`) and has a 90 second deadline. `CONCLAVE_DEBUG_PG=1` prints Postgres output live.
- **The database is UTF-8.** `initdb` on Windows chose `WIN1252` from the system locale, which cannot store emoji or most non-Latin text. Now `--encoding=UTF8 --locale=C --locale-provider=builtin --builtin-locale=C.UTF-8`, with a round-trip test. Also `--no-sync` on the brand-new cluster, which cut first start from about 14 s to about 5 s; an interrupted first start is wiped and rebuilt anyway.
- **Embedded Postgres is `embedded-postgres` 18.6.0-beta.19.** Spiked on Node 24.13 and Windows x64: it initialises, starts, runs PostgreSQL 18.6, and listens on 127.0.0.1 only. Port 54329, read from `PG_PORT`. Role passwords live in `DATA_DIR/secrets/db.json`, outside the repo.
- **One install script is allowed:** `@embedded-postgres/windows-x64`. I read it first: it only recreates symlinks inside its own package folder. esbuild stays denied. The policy stays on for everything else.

## 2026-11-12 (slice 0 setup)

- **Developing on Node 24, supporting 22 and up.** `engines` is `>=22` and `.nvmrc` says 22. Why: Node 24 is installed on the dev machine and CLAUDE.md names Node 22. Before S0-2 we confirm embedded Postgres starts on Node 24; if it does not, switch to 22 then. Replaces "Node 22 only".
- **TypeScript 6.0, not 7.** `typescript-eslint` 8.x declares `typescript <6.1.0`, so TypeScript 7 would break lint. Revisit when typescript-eslint supports 7.
- **Hono and its Node adapter pinned one release back** (`hono` 4.13.17, `@hono/node-server` 2.1.6). The newest releases were under a day old and pnpm's minimum release age policy rejected them. The policy stays on; no exclusions. Move forward when the newer releases age in.
- **Dependency install scripts are denied** (`allowBuilds: esbuild: false` in `pnpm-workspace.yaml`). esbuild ships its binary as a platform package, so its script is not needed.
- **Server on port 3100, web on 3000, both on 127.0.0.1.** The server reads `PORT` and defaults to 3100, matching `.env.example`. SPEC 11, CLAUDE.md rule 9.
- **Lint uses plain `typescript-eslint` for now.** `eslint-config-next` for `apps/web` is added in S0-9, when there is UI to lint.

## 2026-11-12 (v5: talent catalog and the office world)

- **Hiring draws from a talent catalog.** Personas are imported from Agency Agents (MIT) and the Paperclip companies at a pinned commit, then framed with a template and the company rules. A hire is persona + frame + company. SPEC 9.
- **Bake-off before every hire.** Up to three candidates run the same trial task and are scored, boundaries first. SPEC 9.
- **Hiring levels H0, H1, H2 and a roster cap.** H0 until a month of scorecards exists. 20 active agents by default. SPEC 9, 19.
- **Eighteen departments.** Rooms 12 to 18 added: Talent, Design Studio, QA and Testing, Client Success, Finance and Ops, Paid Media, Security and Compliance. All off until their slice. SPEC 4.
- **The office is a WorkAdventure-style world on Phaser 4.** Replaces Pixi.js. Phaser has tilemaps, cameras and physics built in. No WorkAdventure code or maps: its license is AGPL-3.0 with the Commons Clause, and the OS may be sold. SPEC 12.
- **Reads and writes Paperclip's company format.** Internally the OS keeps `AGENT.md`, because OpenCode treats any `AGENTS.md` as rules. SPEC 9.

## 2026-11-12 (v4: model-agnostic)

- **No engine is load-bearing.** The runtime contract is the engine, and each harness is one runtime behind it. Why: Anthropic's docs say Claude Code is not supported on non-Claude models, so a Claude-only engine would tie the OS to one vendor. Replaces "Claude Code is the harness". SPEC 5 (the portability rule), 7.
- **OpenCode moves from slice 7 to slice 0.** It is the model-agnostic CLI harness. Slice 0 proves the contract on two engines with shared conformance tests. SPEC 7, 18.
- **The OpenAI Agents SDK is a runtime, not the core.** `openai-agents` is one generic in-process runner, added in slice 4 for local and API-key models. It needs a local model or an API key and cannot use a plan sign-in, so it does not replace the signed-in CLIs on day one. Agents stay templates. SPEC 7.
- **The hybrid is done by the OS.** Rules file, skills, permissions, connectors and the approval gate are kept once in neutral template files and server-side handlers, and rendered or served to every runtime. Replaces Claude-shaped template files (`CLAUDE.md.hbs`, `.claude/settings.json`, `.mcp.json`) with `RULES.md.hbs`, `permissions.yaml` and `connectors.yaml`. SPEC 5.
- **Local models go through an OpenAI-compatible endpoint.** Replaces pointing Claude Code at Ollama's Anthropic-compatible endpoint, which Anthropic does not support. SPEC 7.
- **The OS never touches a Claude credential.** It only starts the `claude` binary a person signed in to themselves. SPEC 7, 16.

## 2026-11-12

- **Agents are templates, not code.** An agent is a ready-made harness plus a filled-in template. Replaces the earlier plan to write each agent with an SDK. SPEC 5.
- **Subscription first.** Start on the signed-in Claude Code and OpenCode CLIs. Add a local model for all-day scouting next. Add API keys last. SPEC 7.
- **TypeScript for the whole core.** Python only as optional workers over HTTP. Replaces the earlier FastAPI core. SPEC 1.
- **Inngest for workflows.** SPEC 11.
- **Every table carries `workspace_id` from day one.** SPEC 11, 16.
- **Company text in the repo, everything generated outside it.** `company/` is tracked in git. `DATA_DIR` defaults to `~/.conclave-os` so agent working folders never load this repo's `CLAUDE.md`. SPEC 13.
- **Uuid ids with a per-workspace `key`.** SPEC 11.
- **Goal ladder:** $1,000 in month one, $3,000 to $5,000 a month by month three, then $25,000 a month. SPEC 3.

## Still open

See SPEC 19. Numbers 1 and 3 block slice 0: which CLIs on which account, and where it runs. Number 2 (which local model) blocks slice 4. Number 5 (footer address and sender) blocks the first send.
