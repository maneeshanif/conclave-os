# Autopilot: building every slice without stopping

Anees turned this on on 2026-11-12. It replaces two rules in `CLAUDE.md` while it is on: "write a plan first, wait for my OK" and the stop rule in SPEC 18 ("do not start a slice until the one before it is used every week"). Every other rule in `CLAUDE.md` still holds, and the eleven hard rules always win.

## The loop

1. **Questions first, once.** Before any code, ask Anees every question in `docs/QUESTIONS.md` in one message, plus any new ones you find while reading. Then wait. This is the only wait.
2. **Record the answers.** Write them into `docs/QUESTIONS.md` under each question (`**Answer:** ...`). A question he skips takes the default written under it. Log every decision in `docs/DECISIONS.md`. Copy company facts (offers, prices, footer address, markets) into `company/`.
3. **Then, for each slice from the current one to slice 10, in order:**
   - Branch `slice-<n>-<name>` from the previous slice's branch, so unmerged work stacks.
   - Draft the slice's task list in `docs/BUILD.md` in the slice 0 format: small tasks, the SPEC sections to read, one acceptance test each. Commit it. Do not wait for an OK.
   - For each task: write the test first, build until it passes, then run typecheck, lint and `pnpm test`, tick the task, commit with the task id, push.
   - When the slice's "Done when" check (SPEC 18) passes, open a PR into `master` with what was built, how it was tested and what needs Anees. Do not merge it. Move to the next slice.
4. **Keep `docs/PROGRESS.md` current** after every task: branch, last task done, next task, open items. A new session, or a session after a context reset or a plan limit, starts by reading it and carries on from there.

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

- Merge into `master`, force push, or rewrite pushed history.
- Add a runtime, SDK or library before its slice (CLAUDE.md, Stack).
- Copy WorkAdventure code or maps. Office art is Kenney (CC0) or drawn here.
- Give a catalog persona a tool.
