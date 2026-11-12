# Decisions

Newest first. One entry per decision: what, why, and what it replaced.

## 2026-11-12 (S0-2: tenancy keys and policy)

- **Foreign keys cannot cross workspaces.** Every tenant table with an `id` gets `unique (workspace_id, id)`, and every foreign key between tenant tables is `(workspace_id, x_id) references t (workspace_id, id)`. Why: Postgres runs foreign key checks without row-level security, so a plain key lets a row in workspace A point at a row in workspace B. Cheap at schema birth, painful later. Goes beyond the original slice 0 block, so SPEC 11 was updated first. `members` has no `id`, so it keeps its plain key. `departments.lead_agent_id` gains a composite key too, added after `agents` exists. SPEC 11.
- **Policies use `nullif(current_setting('app.workspace_id', true), '')::uuid`.** On a pooled connection that has run `set_config(..., true)`, the setting reads as an empty string, not null, and a bare `''::uuid` raises an error instead of returning no rows. A test covers a one-connection pool. `workspaces` has no `workspace_id`, so its policy is on `id`. SPEC 11.
- **Three database roles.** The `initdb` superuser is used once at first start to create `conclave_owner` and `conclave_app`, then never again, and its password is not stored. The owner owns the tables and is used only for migrations and bootstrap. The app role serves requests with select, insert, update and delete only. If first start is interrupted before the credentials file exists, the half-made cluster holds no data and is wiped and made again. SPEC 11.
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
