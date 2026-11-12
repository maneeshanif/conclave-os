# Autopilot: building every slice without stopping

Anees turned this on on 2026-11-12. It replaces two rules in `CLAUDE.md` while it is on: "write a plan first, wait for my OK" and the stop rule in SPEC 18 ("do not start a slice until the one before it is used every week"). Every other rule in `CLAUDE.md` still holds, and the eleven hard rules always win.

## The loop

1. **The questions are already answered.** Anees answers `docs/QUESTIONS.md` before the build starts; the answers sit under each question (`**Answer:** ...`). A question with no answer takes its default. Do not ask them again. Ask only a new question that blocks a task and that the spec and the answers do not settle, and keep building other tasks while you wait.
2. **Record decisions.** Log every answer that is a decision in `docs/DECISIONS.md`, and copy company facts (offers, prices, footer address, markets) into `company/`.
3. **One branch, `dev`, for everything.** No branch per slice and no PR per slice. Every slice from the current one to slice 10 is built on `dev`, in order. One PR, `dev` into `master`, stays open; Anees merges it when he chooses.
   - Draft each slice's task list in `docs/BUILD.md` in the slice 0 format (small tasks, the SPEC sections to read, one acceptance test each) and commit it. Do not wait for an OK.
   - For each task: write the test first, build until it passes, run typecheck, lint and `pnpm test`, tick the task, commit with the task id, push `dev`.
   - When a slice's "Done when" check (SPEC 18) passes, tag the commit `slice-<n>-done`, push the tag, add a line to `docs/PROGRESS.md`, and start the next slice.
   - `dev` must stay green: never push a commit with failing tests.
4. **Keep `docs/PROGRESS.md` current** after every task: last task done, next task, open items. A new session, or a session after a context reset or a plan limit, starts by reading it and carries on from there.

## When something needs Anees, do not stop: park it and keep going

Write it in `docs/NEEDS-YOU.md` (what, why, the exact step he takes) and build the rest. Examples:

- **An account, key or sign-in** (Resend, Slack, Jira, LiveKit, a social account, an OAuth app). Never create accounts, never ask for a secret in chat, never write one in the repo. Build against a fake or an outbox transport, put the variable name in `.env.example`, and test with the fake.
- **Anything that sends, posts, spends or reaches a real person.** Real transports stay off by default. Only Anees turns them on, in `.env`.
- **A test that only runs on his Windows machine.** Write it, mark it in NEEDS-YOU, and continue.

## When to really stop and wait

- A hard rule in `CLAUDE.md` would have to bend.
- A step cannot be undone and could reasonably go either way (deleting data, rewriting git history, force pushing, changing a migration that already shipped).
- The same task has failed three different ways. Write what you tried in NEEDS-YOU and stop that task, but move on to the next task that does not depend on it.

## Spec and code disagree

Fix the spec first, log it in `docs/DECISIONS.md` with the reason, and continue with the choice that keeps the hard rules. Do not wait for an answer. Anees reviews the log at each PR.

## Never

- Merge into `master`, force push, rewrite pushed history, or create another long-lived branch.
- Add a runtime, SDK or library before its slice (CLAUDE.md, Stack).
- Copy WorkAdventure code or maps. Office art is Kenney (CC0) or drawn here.
- Give a catalog persona a tool.

## Resuming after a limit

A session that hits a usage limit stops. Nothing inside the repo can wake a stopped session, so resuming needs a trigger outside it:

1. **On the laptop (chosen as the main way):** run the session in `/loop` mode with the resume prompt below. The loop re-fires on a timer, reads `docs/PROGRESS.md`, and carries on when the limit has reset. If the limit is still active the turn fails and the loop tries again later.
2. **From the cloud:** a scheduled task can start a fresh cloud session every few hours with the same resume prompt. It only works on what runs on Linux, and it must claim its task first (see below).
3. **Either way:** before starting a task, write `Working now: <task id>, <laptop|cloud>, <time>` in `docs/PROGRESS.md` and push. If a claim is under two hours old, pick the next task. Clear the line when the task is committed.

Resume prompt:

> Autopilot. Read CLAUDE.md, docs/AUTOPILOT.md, docs/QUESTIONS.md (the Answers section) and docs/PROGRESS.md. Claim the next unclaimed task and continue on the `dev` branch. Do not ask anything already answered.
