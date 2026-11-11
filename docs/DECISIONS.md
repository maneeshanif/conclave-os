# Decisions

Newest first. One entry per decision: what, why, and what it replaced.

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
