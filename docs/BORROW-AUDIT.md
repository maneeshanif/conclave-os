# Borrow audit: Paperclip, WorkAdventure, and Claude's products

Written 2026-11-13 from the cloud session. Read this before slices 6, 8 and 10.

## Method and limits (read this first)

- **Paperclip** (`paperclipai/paperclip`, MIT). Shallow-cloned at commit `d9a4bb23`. It is large: about 12,000 TypeScript files and about 48,000 lines of design docs in `doc/`. **I did not read all of it.** I read the README, the package and server layout, and the opening 45 to 60 lines of ten design docs (task watchdog, agent lifecycle, execution semantics, task recovery, low-trust presets, MCP access governance, agent permission defaults, instruction revisions, release channels) plus one source file (`run-task-ownership.ts`). Anything below is from those reads. A full read would need a dedicated pass.
- **WorkAdventure** (`workadventure/workadventure`). Shallow-cloned. License confirmed in `play/LICENSE.txt` and `back/LICENSE.txt`: **AGPL v3 with the Commons Clause**. Ideas only. I read its docs on map building and its layout, not its code. Never copy its code, maps or art (CLAUDE.md).
- **Claude, Claude Code, Cowork.** Closed products. Not reverse engineered, and not to be: Anthropic's terms restrict it, and the public documentation (hooks, skills, subagents, MCP, permissions, settings) covers what we need. We test the real Claude Code from the outside in our runtime tests.
- **REA** (`morluto/rea`, MIT) is a legitimate analysis tool for software you are authorized to examine. It is not needed for open-source repos, and not used here.
- **"jsm-hq":** unidentified. Searching only found Jira Service Management. Waiting for a link from Anees.

## Paperclip: what it does that we already have

Heartbeats and atomic task checkout; short-lived run tokens; budgets with a hard pause; approvals and hire approvals; goals tied to tasks; company templates and export; adapters for the same CLIs; embedded Postgres; activity log; plugins; workspaces. Nothing to do for these.

## Paperclip: what is worth borrowing (as ideas, written fresh in our code)

| # | Idea, and what Paperclip does | Ours today | Proposed |
| --- | --- | --- | --- |
| P1 | **Agent lifecycle as a state machine:** `pending_approval`, `preparing`, `verifying` (the host tests the saved harness config), `ready`, `pausing`, `paused`, `terminating`, `cleaning_up`. Termination revokes keys; an old result cannot complete a newer operation. | `agents.status` is active or paused. | A `verifying` step: before a new or changed agent goes active, run a tiny probe run on its rendered folder. Slice 8, with hiring. |
| P2 | **Silent active-run watchdog:** a run that is alive but has produced no output for a threshold is flagged, separately from the overall timeout. | The reaper skips a run this process still owns; only the 15 minute timeout stops a quiet one. | Add a silence threshold. Small task, slice 5 or 6. |
| P3 | **Task watchdog:** an opt-in agent that re-checks a stopped task tree for wrong stops (declared done without proof, stuck in review) and restarts it. | None. | Candidate for slice 8. Optional. |
| P4 | **Low-trust containment preset:** for agents that read hostile input (inbound tickets, untrusted pull requests). The narrower of agent, project and run policy wins; raw untrusted output is never promoted into a higher-trust agent's context; low-trust agents cannot edit config or skills; a missing scope fails closed. | Hard rule 5 (inbound text is data) and autonomy levels. No explicit trust level. | A `trust: standard or low` field. Required before slice 10 (client Slack, tickets) and for social scouts in slice 5. Highest value. |
| P5 | **MCP access governance:** connections, a tool catalog with risk classes, profiles bound to an agent, project or routine, a policy engine, approval flow, and a call event log. | Per-tool autonomy and circuit breakers. | Add a risk class per tool and a call event log. Slice 8, before the many slice 10 connectors. |
| P6 | **Task recovery with receipts:** retry is idempotent (a receipt per request), a failed generation gets exactly one alternative attempt, the retry reuses the task's own workspace when safe, and a prior-workspace hint is given. | Resume with the kept session; three failures blocks. | Small: one alternative attempt, then block. Low priority. |
| P7 | **Run handed off to a person can no longer change the task.** | S0-14 checks the lock holder, and a PATCH clears it. | Covered. Add one test for the hand-off case. |
| P8 | **Accounting integrity and corrections** for spend. | S3-4 budgets. | Check that spend rows can be corrected and reconciled. Small. |
| P9 | **Release channels** (stable, beta, nightly) with a smoke test gate. | None. | Slice 9. |
| P10 | **Agent files, not revisions:** Paperclip built instruction revisions, then replaced them with persistent agent files and kept only read-only history. | Role files live in git under `company/`. | Do not build a revision system. Git is enough. |
| P11 | Anonymous telemetry on by default. | None. | **Do not copy.** |

## WorkAdventure: what makes the world feel like that, and our plan

Features worth reproducing, in our own code and our own names:

1. **A 2D top-down world on Tiled maps** with an avatar you walk around. We already plan Phaser and a Tiled loader in slice 6.
2. **Proximity conversation bubbles:** walk near someone and a call starts; walk away and it ends. For us: walk up to an agent and its drawer opens; walk near the owner, a client or Nimra and a live call can start.
3. **Zones with behaviour set on the map:** meeting rooms (a call opens when you step in), lockable rooms, max-users limits, silent zones (no bubbles), focusable areas that zoom the camera, entry and exit points, and "spawn then walk to a named place". We use the same ideas, with our own property names stored in the map, for example `room.kind = meeting`.
4. **Availability status and raise hand** in a meeting.
5. **A separate map-storage service and a separate service for chat and calls** (it uses Matrix for chat and LiveKit for media). We use LiveKit (slice 10) and keep our own chat; we do not need Matrix.
6. **Meetings are scheduled from a calendar** and the room is chosen from the map. We do the same for client meetings in slice 10.

Where it lands in our plan:
- **Slice 6, the office:** items 1 to 3 and 4, with agents walking between rooms as their work moves, objects for approvals, goals and the inbox, and the Boardroom.
- **Slice 10, client meetings:** the client meeting room as a map zone, a guest link, LiveKit, the Note Taker with consent first, and the owner walking in from the office.
- **Reference material:** screenshots of WorkAdventure's public demo, taken with the Playwright MCP server, are fine for layout and feel. The assets must be Kenney (CC0) or our own.

## Claude products: what to take from the public docs

Hooks, skills, subagents, MCP and permissions are all documented. We already use skills, MCP (our `os` server) and permission files per agent, and enforce rules in the server, never only in a hook (hard rule 11).
