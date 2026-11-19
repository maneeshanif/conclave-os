# Parity check: jsm-hq, Paperclip, WorkAdventure, the Agent Factory book

Written 2026-11-20 from the feature lists in `docs/JSM-REFERENCE.md`, `docs/BORROW-AUDIT.md`, `docs/WORLD-REFERENCE.md` and the slice table in SPEC 18, checked against the repo (each "done" below was looked for in the code, not remembered). In our own words; nothing is copied from any of them.

**Status words:** done, partial (what is missing is said), not built (and why), blocked (needs something only Anees can give: see `docs/NEEDS-YOU.md`).

## jsm-hq (MIT, read for ideas)

| Feature | Status |
| --- | --- |
| Office page with the world filling the screen, controls floating over it | done (S6-15) |
| Plan wall of sticky notes from tasks | done |
| Boards (a tab per goal, a column per status) | done (Boards panel, the ▦ button) |
| Pull requests drawer and board in the Hall | done (Pull requests panel) |
| Conveyor of parcels into the review board | done (one parcel per open pull request) |
| Live terminal of a run in an agent's drawer | done |
| Zoom in whole steps, overview | done |
| Drag to pan | done |
| Demo mode with 1x, 2x, 4x | done, but partial: it acts out states (working, discussion, handoff, waiting, blocked, idle) on this screen only; people do not walk around while it runs |
| Layout generated from the team | done (S6-13b: a department gets a room; the map editor adds the rest) |
| Hover tooltips, click opens the drawer | done |
| Action items with a count, Settings, Debug | done (action items, Settings); a Debug panel is not built (the tool-call log and the Health screen cover what it would show) |
| Settings tabs Team / Workflow / Stack / MCP / Sandbox / Boards / Project | partial: our Settings has Hiring, Agents, Spend correction, Delegate, Sending, Meetings, Watchdog, Updates, Connectors, Tool calls. A "Stack" tab (which model for which role) is not on the screen: models are set in the agent's own file |
| Sandbox status pill | not built: the OS runs agents with a clean environment and no shell by default (rule 10), which is the same promise; there is no separate sandbox to show |

## Paperclip (MIT, ideas only)

BORROW-AUDIT items P1 to P11:

| # | Status |
| --- | --- |
| P1 agent verified before ready | done (A4, the folder probe; a failed probe keeps the agent out of the loop) |
| P2 silent-run watchdog | done (`silenceMs` in the loop) |
| P3 task watchdog | done, opt-in (A7, a switch on Settings) |
| P4 low-trust containment | partial: inbound text is data (rule 5), persona text from the catalog never gets a tool, untrusted agents cannot edit skills (self-writing is off by default and set per agent). A named low-trust preset that narrows project and run policy together is not built |
| P5 tool risk classes and a call log | done (A3, `TOOL_RISK`, the Tool calls list on Settings) |
| P6 one alternative attempt on a failed run | done (retry, then the other model, then block) |
| P7 hand-off cannot change the task | done (tested) |
| P8 spend corrections | done (A5, with a form on Settings) |
| P9 release channels with a smoke gate | done as rules and a Settings choice (A6); nothing downloads or installs an upgrade yet |
| P10 no revision system | kept as decided (git is the history) |
| P11 telemetry | not built, on purpose |

Also in Paperclip and already ours: heartbeats and atomic checkout, run tokens, budgets with a hard pause, approvals and hire approvals, goals tied to tasks, company templates and export, adapters for the CLIs, embedded Postgres, activity log, plugins.

## WorkAdventure (AGPL with Commons Clause: ideas only, no code, no maps, no art)

| Feature | Status |
| --- | --- |
| 2D top-down world on Tiled maps, walk by keys or click | done |
| Map editor in the app (place, remove, move, drag, doors, room size) | done; making a room smaller and adding a new wing are not built |
| Rooms with behaviour (max users, locked, silent, focusable) | done in the map model and the office rules |
| Walk up to someone and a bubble opens | partial: text bubbles and chat are done; audio and video are blocked (S6C-3: a camera, a microphone and a media server are needed to test) |
| Screen sharing | blocked, same reason |
| Locking a bubble | not built (nothing to lock without audio and video) |
| Global announcements and pinned messages (megaphone) | done |
| Quick reactions | done |
| Following somebody | done |
| User list with status, go to, message | done |
| Status synced to other tools | not built: no Slack or Teams sign-in (blocked) |
| Avatar customisation in parts | blocked (needs layered art; six whole looks exist) |
| Chat sync and sign-in with Discord, Slack, Teams | blocked (accounts and keys); our Slack stand-in writes to a folder |
| Embedded tools (Trello, Notion, Miro, Google) | not built: panels open our own tools only; this would be an iframe allow-list, a decision for Anees |
| Calendar links | partial: client meetings have a planned time and a guest link; there is no calendar feed |
| White labelling | partial: nothing about one company is in `apps/` (rule 8), so the name and look come from `company/`; there is no theme screen |
| Gamification and badges | not built, on purpose: it does not help run a company |
| Themed offices (sci-fi, medieval, nature) | blocked (needs art) |

## The Agent Factory book (the SPEC 18 slice table)

Every slice from 0 to 10 is built to local stand-ins and has its "done when" test or check. The items that need the outside world are listed in `docs/NEEDS-YOU.md` (real sign-ins and keys for GitHub, Vercel, LiveKit, Slack, Jira, Retell, Twilio and the Claude Agent SDK, and the pgvector check). The stop rule in SPEC 18 (do not start a slice until the one before is used every week) is waived by Anees's autopilot instruction, noted in `docs/DECISIONS.md`.

## What is still open after this check

1. Blocked on you: audio and video, screen sharing, avatar parts art, Slack and Discord sync, themed art, real sign-ins and keys.
2. Small, doable on request: a low-trust preset (P4), a Stack tab on Settings, shrinking a room, a Debug panel, an embedded-tools allow-list, a calendar feed.
3. Not a gap but a choice: telemetry and gamification are left out on purpose.
