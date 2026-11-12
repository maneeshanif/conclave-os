# Decisions

Newest first. One entry per decision: what, why, and what it replaced.

## 2026-11-12 (S1-10: owner login)

- **Better Auth 1.7 with the passkey plugin,** checked against its current docs and installed types, not the spec sketch. Login is OFF by default and nothing changes locally. LOGIN=on turns on the wall: every /api route and the event socket need a session; only /api/auth/*, /health, the agents' run-token endpoint (/mcp) and Inngest stay open.
- **The wall cannot be off on the network.** resolveAuthConfig throws, before anything listens, if BIND_HOST is not loopback and LOGIN is not on, or if PUBLIC_WEB_ORIGIN is missing or not https. Cookies are HttpOnly and SameSite=Lax always, and Secure once the server listens beyond loopback or the web origin is https. Tested.
- **The first owner gets in with a one-time code, not a password.** A passkey can only be added by someone already signed in, so a code (50 bits, 15 minutes, used once, stored only as a hash, claimed in one SQL statement, locked after 10 wrong guesses) is written to DATA_DIR/owner-setup-code.txt for the person at the machine. It is never printed to a log (rule 4). A signed-in owner makes the same kind of code for a new device. A setup code is only written while there is no owner. If the owner loses every device and every signed-in session, there is no way back in yet: a command run at the machine that issues a fresh code for the existing owner is still to build (listed under open items below).
- **Passkey identity is localhost,** because an IP address cannot be a passkey identity. With login on, open http://localhost:3000 and use http://localhost:3100 for the API (127.0.0.1 would make the cookie cross-site). PUBLIC_WEB_ORIGIN and PUBLIC_API_ORIGIN change this for a Tailscale https address.
- **Identity tables are in their own schema, auth,** with no workspace_id and no row-level security: a person signs in before any workspace is chosen, and rule 2 is about tenant data. The members table (which has both) ties the owner to the workspace. Migration 0008 (tables) and 0009 (grants to the app role only).
- **Devices:** /api/owner/devices lists signed-in sessions and revokes one; /api/owner/codes makes a code for a new device. The cookie secret is AUTH_SECRET or a file made in DATA_DIR/secrets.
- **Tested:** 27 server tests and 6 page tests, and the real server on a throwaway folder: 401 without a session, wrong code 401, right code 200 with an HttpOnly cookie, the code file removed after use, session then 200, loopback only. **Not tested:** a real passkey ceremony, which needs a browser and an authenticator. The server issues the challenge for the right identity and the web page builds. Please try it once in a browser (S1-12 repeats this).
- **Open for S1-11/12:** (1) Inngest (/inngest) is not behind the wall; it must have its signing key set before remote access is switched on. (2) A recovery command for an owner who lost every device (a code issued from the machine) is not built yet. (3) "Every approval records the device it came from" is S1-11.

## 2026-11-12 (S1-9: action items)

- **Two kinds of item.** Recorded items are rows in action_items (a question from ask_founder, a failed send, a send of unknown outcome) and are resolved by hand. A blocked task with no open question and the kill switch being on are derived from live state, have no row and clear themselves, so they cannot be resolved (the API says 404 for them; the page shows no button). A task that is blocked because of a question appears once, as the question.
- **Resolving records and nothing else.** It stores who, when and an optional note, writes an audit line, and announces action_item.changed. It never unblocks, restarts or sends anything: the task stays blocked until someone moves it. A second resolve is refused with 409 and records nothing more.
- **A failure shows once.** A unique index on (workspace, approval, kind) stops the same failure being recorded twice, and the executor inserts now say on conflict do nothing. Migration 0007 adds task_id (composite FK to tasks), resolved_at, resolved_by, resolution_note and that index.
- **ask_founder now writes the item,** in the same transaction that blocks the task, so the question cannot be lost between the two.
- **/action-items page,** "Needs you", linked from the home page; it refreshes on action, task, settings and approval changes. Like the inbox it is tested in jsdom and has not been looked at in a browser yet (S1-12).

## 2026-11-12 (S1-8: the approvals inbox page)

- **/approvals lists what is pending, one card each.** An email card shows who it goes to, the lead and site it rests on, the findings recorded for the lead, who proposed it, and the full subject and message as editable fields. Approve and Reject sit under it, with an optional note. Any other kind of approval shows its payload as plain text with the same two buttons and nothing to edit.
- **The page never sends anything.** It posts a decision to the server; the executor acts on it. An edit is sent only if the text really differs from the proposal (changing it and putting it back sends none), and only the subject and message can be edited, matching what the server accepts.
- **Safe against double clicks and races.** A card ignores a second click while a decision is in flight. If someone else already decided it, the server's message is shown above the list and the list refreshes. A refused edit keeps the card so it can be fixed and retried.
- **Live.** The list refetches on the server's approval.changed event and ignores other events. The socket code moved to lib/live.ts; the component takes its client and event source as props, so the tests use no network.
- **Not yet looked at in a browser.** The component is tested with 14 jsdom tests and the web app typechecks, but I have not rendered the page in a browser. S1-12 does a full browser check; reading the real page is the first thing to do when you check back.

## 2026-11-12 (S1-7: the email executor, wired into the server)

- **A real race in the send cap, found by a stress test and fixed.** The cap counted what was sent and what was mid-send in two separate statements, and each statement sees its own snapshot. An email that finished between them was in neither count, so a third email slipped past a cap of two. It showed once in three full test runs and not at all when the file ran alone; a burst test of nine parallel sends against a cap of three then sent four in its first round. Everything the cap counts is now read in one statement. Two tests keep it honest: one asserts the counting is a single query, the other runs eight bursts and requires exactly the cap each time. The executor is the last line before an email leaves, so an intermittent failure there was investigated, not rerun until green.
- **index.ts now has the whole email path.** The transport and the executors come from src/outreach.ts; the approval gate is the in-process one by default and the Inngest one when Inngest is configured; a proposal tells the gate to wait; a decision reaches the gate after it commits; the company folder is passed to the os store, so the claims-and-prices check reads the real COMPANY.md (it had been given none, which would have refused every price); and on start the gate recovers: it sends what was approved while the server was down, once, and waits again for what is pending.
- **The outbox is the only transport unless two settings are both set** (OUTREACH_TRANSPORT=resend and RESEND_API_KEY). An API key alone changes nothing, one without the other stops the server at start with a message, and the server prints which transport it is using. Nothing in this slice turns on a real transport.
- **No sender address, no send.** The sender comes from OUTREACH_FROM and is never invented or hard-coded (rule 8). With it unset the executor refuses the email, says which setting to fill in, raises an action item, and the server warns at start. Together with the footer check, a real send needs both settings the founder owns.
- **Release is its own narrow path.** POST /api/settings/release-held sends only the approved emails that something was holding, oldest decision first, and never touches one that is mid-send. Recovery was not used for it, because recovery marks anything mid-send as interrupted, which would wrongly fail an email being sent right then. On Inngest an email still over a cap after release waits for the next start.
- **Checked on the live server,** on a throwaway data folder and ports: it announces the outbox, warns about the missing sender, serves settings and leads, listens on loopback only, and shuts down clean.

## 2026-11-12 (S1-6: the outreach-rep template and outreach-kit)

- **plugins/outreach-kit is the first real plugin.** A folder with a strict manifest (plugin.yaml: name, version, description, skills, connectors, tools), skills in the open Agent Skills format, and a README. The loader refuses a manifest that lies: a name that is not its folder, a listed skill with no SKILL.md, a tool that is not a real os tool (so the list cannot drift from the server), a connector that is not built yet (only os exists), or any unknown key. A plugin name is a folder name and nothing else, so no name can reach outside plugins/.
- **A role that names a plugin gets what it carries.** The renderer writes the plugin skills into the same folder as the template skills, for both engines, byte for byte, and the role file lists the plugin, its skills and its connectors. A skill name that two sources both claim is an error, never a silent overwrite. plugins/ sits beside templates/ (SPEC 13).
- **outreach-rep starts at autonomy 0, like every new hire (SPEC 5).** At 0 the propose_email tool is not offered, so a new rep drafts in comments as its trial and is promoted by the founder. agent:new gained --autonomy so that is one flag at hire time instead of a hand edit; the CLI now reports the level it really set.
- **The rep has no web access and no shell on either engine.** The audit that finds the facts is another agent job, so the rep reads its lead through get_lead and writes. Rendered folders for both engines are snapshot-tested, and the test checks the allow list is only the work folder plus the os tools.
- **The output check is written down, not yet machine-run.** SPEC 18 puts output checks, repair and escalation in slice 3. Until then the limits (subject under 8 words, body under 170, one call to action, two verified findings) live in checks/README.md and the skill, and what must always hold is enforced in code by propose_email and the executor, as before.
- **Checked: told to send by any other route, the rep cannot.** The rendered outreach-rep on both engines, run through the real os server against a CLI that tries send_email, gets "Unknown tool", and the run leaves no approval, no message, no audit entry and no outbox. This tests the door, not a real model: whether a real model follows the skill is judged in the slice 1 end to end and in the trial.

## 2026-11-12 (S1-5: settings, the kill switch and the send caps)

- **Two caps, both settings.** A rolling window, 30 emails in 5 hours by default (window_hours, window_cap), where follow-ups count like first emails; and a per-day cap, which I set to 100 by default because the answers fix the window at 30 per 5 hours but give no daily figure (a day holds a bit under five windows). Anees can change all three at any time with PATCH /api/settings. Database checks keep them sane: 1 to 168 hours, 1 to 100000 emails.
- **Over a cap an email is held, not failed.** It is not claimed, stays approved, creates no action item, and goes out when there is room: the executor says when (the moment the oldest send leaves the window, or the next local midnight for the daily cap, whichever is later). The in-process gate keeps one timer per held email; the Inngest function sleeps until then and tries again as its own durable steps, up to 100 times. Recovery reports what it held. Replaces the earlier rule that a daily cap fails the approval with "approve it again tomorrow", which a terminal state could never allow.
- **Checking the cap and claiming the email are one step.** Under a workspace-wide lock, inside the claim transaction, so a burst of parallel sends cannot all see the same free slot; emails mid-send count against the cap. Six parallel sends against a cap of two sent exactly two.
- **The kill switch has four effects and a boundary.** On: the run loop refuses new runs (already so), the executor claims nothing, and, after the commit, running runs are cancelled and queued requests dropped (harness/kill-switch.ts, wired into index.ts). It also tells the inbox and writes the audit log with before and after. Off: it only clears the switch. Work that was stopped or dropped does not come back, and approved emails it was holding are NOT sent as a side effect; POST /api/settings/release-held sends them on request, and not while the switch is on. Otherwise a stale decision could leave the building the moment someone said all clear.
- **The settings row is created on first read,** by the API; before that, every reader uses the defaults. Nothing created it before, so the executor had been running on a hard-coded fallback.
- **A routing fix:** the "malformed id is a 404" guard treated /settings/release-held as an id and rejected it. Settings is exempt.
- **Not wired yet:** onReleaseHeld in index.ts (with the gate and the executor, in S1-7).

## 2026-11-12 (S1-4: leads and the suppression list)

- **One lead per address, however it is typed.** Addresses are trimmed and lowercased, and a unique index on `(workspace, lower(email))` (migration 0004) is the backstop; creating uses `on conflict do nothing`, so two creates for one address at the same moment give one lead and one 409 that names the existing lead. Leads without an address are unlimited.
- **Do-not-contact is a fact about the address, not only a stage.** Marking a lead do-not-contact (or creating it that way, or changing the address of one that is) puts the address on the suppression list in the same transaction. The proposal handler and the executor both check the list, so the block holds even if someone later edits the stage. Moving a lead out of do-not-contact is refused (409) while its address or domain is still listed.
- **Removing from the suppression list is never a side effect.** `DELETE /api/suppression/:id` needs a reason of at least three characters and writes who removed what, why, and the original reason to `audit_log`. Adding is idempotent (200 with the existing entry the second time) and logged too. Values are an email address or `@domain`, lowercased on the way in. Together with the S1-1 fix the list matches however an entry was typed.
- **Search treats `%` and `_` as plain characters** (escaped), and lists are capped at 500 per page (default 200).
- **Browser CORS now allows `DELETE`,** for the suppression list.

## 2026-11-12 (S1-3: the approval gate)

- **One decision flow, two engines.** Wait up to three days for the decision; approved runs the executor once; rejected does nothing; no decision marks it expired. As an Inngest function it uses `step.waitForEvent` on `approval/decided`; in process it uses one timer per pending approval. The in-process gate is the default; Inngest is used only when configured, exactly like the run loop.
- **The wait matches by field, not by string.** `match: "data.approvalId"` instead of the SPEC sketch's `if` expression with the id spliced in, so no id can alter the expression.
- **The database row is the truth, and start-up rebuilds the waits.** On start the gate gives every still-pending approval a live wait again (with the time already spent counted, so a two-day-old proposal has one day left), expires any older than three days (never sent, a late decision answers 409), sends approved emails that never ran, and marks anything left mid-send as failed and raised to a person, never resent. Running recovery twice sends nothing the second time.
- **Sending exactly once rests on the claim, not on the gate.** Two processes that both hear one decision both call the executor; the `approved` to `executing` claim lets one through. The gate never retries the execute step, and an executor that throws is logged and does not fail the API call that made the decision (it already committed). With the kill switch on, an approved email is held, not lost, and goes out when recovery runs after the switch is off.
- **Not yet verified on a real Inngest server.** The function is registered with the right trigger and `retries: 0` and its logic is tested with a stand-in for `step`, but no Inngest server is installed on the laptop, so the durable wait itself has not been run. Logged in BUILD.md (S1-12). Wiring the gate into `index.ts` waits for S1-7, which also owns the transport and footer settings.

## 2026-11-12 (S1-2: approvals API)

- **A decision is one locked move, `pending` to `approved` or `rejected`, and never moves back.** The row is locked (`for update`) while it is decided, so two decisions at the same moment give one 200 and one 409, and the gate hears once. Anything not pending (decided, expired, executing, executed, failed) answers 409 with its current status.
- **A card can be edited, but only its text.** For an email the edit may change the subject and the body; the recipient, the lead and the step cannot change, and an edit that tries is refused (400) and decides nothing. The proposal is kept as proposed in `payload`; the edit goes in `edited_payload`, which the executor already prefers. A kind with no editable card (a post, for now) refuses an edit but can still be approved or rejected as it is. An edit sent with a rejection is ignored.
- **Deciding sends nothing.** After the commit the API publishes `approval.changed` for the inbox and calls `onApprovalDecided`, the hook the gate (S1-3) attaches to. Rejecting also closes the queued outreach message.
- **The decider is recorded as `founder` until login exists** (S1-10), which will pass the signed-in person instead.

## 2026-11-12 (S1-1: two real bugs found by testing the slice 1 code)

- **A suppressed address was still sent to when its list entry had capitals.** `isSuppressed` lowercased the recipient but compared it to the list as it was stored, so an entry typed as OWNER@CLINIC.COM never matched owner@clinic.com. The executor sent. Both sides are now trimmed and lowercased, and an empty entry matches nothing. S1-4 also normalises on insert.
- **The cold email footer was cut after its first line, and an empty footer section read as the next heading.** The regex used the `m` flag, so `# Decisions

Newest first. One entry per decision: what, why, and what it replaced.

 matched at the end of every line. A two-line address kept only its first line, so the check passed on a footer with no address in it, and a cold email could have gone out without a postal address (SPEC 15). The section is now read line by line up to the next heading of any level; Windows line endings are handled.
- **Tests no longer depend on what is in the repo's `company/departments/`.** The e2e hires a researcher into the repo's company folder, and the test helper copied it, so a leftover hire made agentNew skip rendering the agent's folder and broke an unrelated test. The helper now copies the company folder without any hired agents. S0-15 (the e2e using its own folder) is still open.
- **The kill switch is covered at the loop and the executor:** with it on, no run starts and no CLI is called, an approved email is not claimed and not sent, and it goes out unchanged once the switch is off.

## 2026-11-12 (local model check on the laptop)

- **The machine.** 15.7 GB of RAM, about 3.2 GB free with Chrome, VS Code and Claude Code open. GPU: an NVIDIA MX550 with 2 GB of VRAM (and Intel Iris Xe), which cannot hold a 7B model, so a local model runs on the CPU and in RAM.
- **What is installed in Ollama.** `gemma4:latest` (7.5B parameters, Q4_K_M, 6.6 GB; its description lists tools, thinking, vision and audio), `nomic-embed-text` (274 MB, an embedding model, the natural fit for slice 8 memory) and `gpt-oss:120b-cloud`.
- **The only local candidate that fits 16 GB is `gemma4:latest`,** and only with about 8 GB free (weights plus a modest context; its 131k default context must be capped). It is a candidate, not a choice: its description saying it supports tools is not evidence. Per the rule above, it becomes `local-worker` only after `apps/server/test/real-local-model.test.ts` passes (the real opencode binary, the real model, the real `os` server: get_task then complete_task with a run token, a real answer, no shell, no token leak). The test is written and skipped until you opt in, and it refuses to load the model when too little RAM is free. The `local-worker` alias in `config/models.ts` is unchanged and still a placeholder (`qwen3:8b` is not installed here).
- **`gpt-oss:120b-cloud` is not used for anything.** It runs on Ollama's servers, not here.

## 2026-11-12 (e2e on the Windows laptop)

- **S0-11 on Windows: Claude Code passes, OpenCode is blocked by an expired OpenCode key.** `pnpm run e2e` ran the researcher on `claude-cli`: task done, answer in the thread with line references, run log free of this repo's CLAUDE.md. On `opencode` (alias `any-model`, which means OpenCode's own default model) the run failed before it started with an expired-key message from OpenCode, so the task was blocked with that reason and nothing was sent. The build does not create or replace keys; the step is in NEEDS-YOU. Per S0-11, the box stays as it was until OpenCode has a working provider, and this entry is the record.
- **The e2e hires its researcher into the repo's `company/`** when it is missing, which leaves `company/departments/research/...` untracked after a run. Left uncommitted on purpose: a hire is a company decision, not a test artifact. Worth changing so the test uses its own company folder (`COMPANY_DIR` exists for that); logged in BUILD.md.

## 2026-11-12 (pnpm dev on Windows)

- **`pnpm dev` no longer uses `pnpm -r --parallel`.** On Windows that mode gives each child a stdin pipe that nobody writes to or closes, and the server then sits silent at no CPU and never listens. Measured on the laptop: with `-r --parallel` the server stalled 7 of 7 starts (5 of 5 with only the server in it); started on its own with stdin closed or inherited it started every time (17 to 19 s); with a stdin pipe held open it stalled 3 of 3. It is not Next, not Postgres and not initdb. `scripts/dev.mjs` starts the server and web app with stdin closed, prefixes their output, and stops both when one exits or on Ctrl+C. Checked: 8 real `pnpm dev` starts, all up in 18 to 22 s. The earlier watchdog is still worth having: one stall was traced into initdb, but it was a rare second problem, not the common one. Replaces `pnpm -r --parallel --if-present dev`.

## 2026-11-12 (initdb watchdog, data safety, local model)

- **initdb runs under a watchdog on Windows.** On the laptop initdb stalled about one run in ten (the `postgres --check` bootstrap child sat idle), even on a fresh directory with nothing else running, and the library waits forever, so the server never started. Found with traces: `before initialise` printed and `after initialise` never did. Now: 60 s per attempt, the whole process tree killed, the half-made directory cleared, up to three attempts; a real failure (non-zero exit) is reported at once and never retried. Other platforms keep the library's `initialise()`.
- **Nothing in the OS ever deletes a database that holds data.** `runInitdb` refuses a target that has `PG_VERSION` or any file it did not create, and on a retry removes only what its own attempt made; an empty directory it was given stays. `startDatabase` wipes a cluster only when this server began creating it and never finished: a marker file (`first-start.marker`, in `DATA_DIR`) is written before initdb and removed after the credentials are written. A cluster with `PG_VERSION` and credentials that are missing, corrupt or the wrong shape is refused with instructions, never wiped; put the credentials file back and it starts with its data intact. This replaces the earlier S0-2 rule that wiped any cluster without a credentials file, which would have destroyed a real database if that file was lost.
- **`local-worker` is chosen only after the model passes the runtime conformance tests with tool calling.** No model is named for it before that, and the placeholder in `config/models.ts` is not a recommendation. A model that cannot call the `os` tools through its runtime does not qualify, however well it chats.
- **`gpt-oss:120b-cloud` is an outside cloud model, not a local one.** Ollama lists it, but it runs on Ollama's servers, so a prompt sent to it leaves the laptop. It is never used for `local-worker`. If it is ever used for anything, that use is logged here first, with what is sent to it.

## 2026-11-12 (S0-14: task ownership)

- **A run acts on a task only while it holds it.** `comment`, `complete_task`, `block_task` and `ask_founder` need the task to be `in_progress` and `locked_by` the calling agent. The check and the write share one transaction with the task row locked (`for update`), so a person moving the task cannot slip in between. Before, only `done` and `cancelled` were refused, so a run still going after its task was reset could finish it. A task already blocked by `ask_founder` refuses a second tool call in the same run.
- **`PATCH /api/tasks/:id` releases the lock** whenever it changes the status, to `todo` or `cancelled`. Renaming alone leaves the holder in place.
- **The Inngest registration is pinned by a test** that reads the payload the app sends to Inngest: `agent-run` on `agent/run.requested` with the limits two overall and one per agent, no retries, and a `ticker` every minute.

## 2026-11-12 (S0-13: heartbeats and turns)

- **The ticker remembers when it last asked each agent**, in memory for as long as the server runs. An agent with nothing to do leaves no run row, so the old rule ("due when the last scheduled time is after the last heartbeat run") kept finding it overdue and asked every minute. A restart forgets, which at worst asks once more.
- **One waiting request per agent.** The dispatcher drops a request when one is already queued for that agent, whoever sent it, because the run takes whatever task is ready when it starts. A request that arrives while the agent is running is kept, so a task created mid-run still gets its run.
- **A Claude turn is a message, counted once by `message.id`.** Claude Code streams one model message as one event per content block. An event with no id counts itself, so a stream that omits ids still reaches the limit.

## 2026-11-12 (S0-12: Windows process handling)

- **An npm `.cmd` shim is read, not run through a shell.** The resolver parses the shim and starts the program it forwards to: either a native `.exe` (this laptop's `opencode.cmd` does that) or `node` plus a script. A shell is the last resort for a shim it cannot read. Why: a shell adds a process, quoting rules and a second thing to kill. `claude` here is already a native `.exe`. `health()` and `start()` now quote through one function.
- **One way to start a command, in the runner, `health()` and `pnpm run doctor`.** A shell is the last resort, and then it gets one quoted command string, never an argument list (Node warns about that, DEP0190). Doctor used to start everything through a shell on Windows.
- **Cancel and timeout end the whole process tree on Windows** with `taskkill /pid <pid> /T /F`. `child.kill()` ends only the process we started, and a CLI runs its tools as children. Checked by a test that starts a fake CLI with its own long-lived child, cancels, and finds the child gone. Other platforms keep `child.kill()`.

## 2026-11-12 (build answers from Anees)

- **All 38 questions are answered** in `docs/QUESTIONS.md`, section "Answers". One branch `dev`, one PR, built mostly on the laptop with the cloud session as a second pair of hands, claims in `docs/PROGRESS.md`.
- **No hidden recording.** Anees asked to record client meetings without telling them. The Note Taker records only with a consent notice every participant sees; the wording follows the market but the notice cannot be switched off. Recording people without telling them is illegal in many places.
- **A live AI voice in client calls is wanted,** and built last in slice 10, behind mock-call evals, and it says it is an AI.
- **Email cap 30 per day, morning brief 13:00 Karachi, backups kept 90 days.** All settings.
- **Meetings, channels, CRM and tickets sit behind adapters** (several providers each), so a new one is a connector and not a change to the core.
- **Email cap is a rolling window:** 30 per 5 hours by default, plus a per-day cap, both settings.
- **Resume after a limit:** laptop `/loop` first, cloud scheduled task as backup, with claims in `PROGRESS.md`.
- **Meeting consent comes first:** the agent asks at the start, in chat and aloud, before recording. A "no" or no answer means nothing is recorded, Anees is notified and joins the call with the agent.
- **The course-creator company template is a deliverable of slice 9,** documented so another teacher can install it.

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
