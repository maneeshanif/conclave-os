# Decisions

Newest first. One entry per decision: what, why, and what it replaced.

## 2026-11-12

- **Agents are templates, not code.** An agent is a ready-made harness (a signed-in CLI) plus a filled-in template. Replaces the earlier plan to build agents with an SDK. SPEC 5.
- **Subscription first.** Start on the signed-in Claude Code and OpenCode CLIs. Add a local model for all-day scouting next. Add API keys and the `claude-agent` runtime last. SPEC 7.
- **TypeScript for the whole core.** Python only as optional workers over HTTP. Replaces the earlier FastAPI core. SPEC 1.
- **Inngest for workflows.** SPEC 11.
- **Every table carries `workspace_id` from day one.** SPEC 11, 16.
- **Company text in the repo, everything generated outside it.** `company/` is tracked in git. `DATA_DIR` defaults to `~/.conclave-os` so agent working folders never load this repo's `CLAUDE.md`. SPEC 13.
- **Uuid ids with a per-workspace `key`.** SPEC 11.
- **Goal ladder:** $1,000 in month one, $3,000 to $5,000 a month by month three, then $25,000 a month. SPEC 3.

## Still open

See SPEC 19. Numbers 1 and 3 block slice 0: which CLIs on which account, and where it runs. Number 2 (which local model) blocks slice 4. Number 5 (footer address and sender) blocks the first send.
