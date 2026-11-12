# Needs Anees

Things the build parked for you. Each says what to do.

- **OpenCode key expired (blocks the OpenCode half of the e2e on this laptop).** The run failed at once with "This API key has expired. Create a new API key in OpenCode Console and replace it in your client or secret store. Signing in again will not renew this key." The build cannot create or replace a key. What to do: open https://opencode.ai/console/account#api-keys, create a new key, and put it where OpenCode keeps its credentials on the laptop (`opencode auth login`, which you run yourself). Then say "retry the OpenCode e2e" and the build runs `pnpm run e2e` again. Nothing was sent to OpenCode: the key was refused before the task text left the machine. Until then the claude-cli half passes and the OpenCode half is the only thing the Windows e2e is missing.
- **Free some memory, then the local model test can run.** `gemma4:latest` needs about 8 GB free to load and the laptop has about 3 GB free with Chrome and VS Code open. Close them (or most tabs), then say "run the local model test". It runs `apps/server/test/real-local-model.test.ts`, which decides whether `gemma4:latest` can be `local-worker`. You can also run it yourself in PowerShell, from the repo folder:

  ```powershell
  $env:CONCLAVE_TEST_OPENCODE = 'C:\Users\HP\AppData\Roaming\npm\node_modules\opencode-ai\bin\opencode.exe'
  $env:CONCLAVE_TEST_LOCAL_MODEL = 'gemma4:latest'
  pnpm exec vitest run apps/server/test/real-local-model.test.ts
  ```

  It unloads the model when it finishes. `gpt-oss:120b-cloud` is never used for this.
- **Before promoting an outreach rep to autonomy 2, read its first few drafts.** A new `outreach-rep` starts at autonomy 0 and cannot propose; it writes its first emails as comments on its tasks (its trial). Read the first few. If they are good, promote it: `pnpm agent:new outreach-rep --department outreach --autonomy 2` for a new one, or set `autonomy: 2` in its role file. From then on its drafts arrive in your approvals inbox. The rep's limits (under 170 words, two verified findings, one call to action) are only in its skill text until slice 3 adds a machine check, so your reading is the check for now. Claims, prices, the suppression list, the send caps and the kill switch are enforced in code regardless.
- **One-off: run the approval gate against a real Inngest dev server (optional, nothing else depends on it).** The default gate is the in-process one, and slice 1 is tagged without this. The build could not start the Inngest dev server itself (the sandbox refused to download and run the `inngest-cli` package, and the build does not work around that). Test file is ready: `apps/server/test/real-inngest.test.ts`. In one PowerShell window run `npx inngest-cli@latest dev -u http://127.0.0.1:3191/inngest`. In a second, from the repo folder: `$env:CONCLAVE_TEST_INNGEST = '1'; pnpm exec vitest run apps/server/test/real-inngest.test.ts`. It proposes an email, waits inside Inngest, approves it and checks it is sent exactly once. Say "Inngest check passed" or paste the failure. Close the dev server afterwards.
- **Lead sources that need an account (later, not blocking).** The lead-gen agents find leads from public pages, and you can drop a CSV into POST /api/leads/import. Apollo, Clay, Apify and Google Maps are not connected: each needs an account or key that only you can create, and the build does not make accounts or enter keys. When you want one, say which, create the account yourself, and the connector gets its own task. Until then a CSV from any of them works.
- Windows run, done on this laptop on 2026-11-12: `pnpm install`, `pnpm test` (174 pass), `pnpm run doctor` (passes) and `pnpm run e2e` on Claude Code (passes). `pnpm run e2e` on OpenCode: see the first item.
- Fill the TODOs in `company/COMPANY.md`, including the cold email footer address.
- Cold email footer address and sending domain/service (Q7, Q8). Real sends stay off until both exist.
- Offers and prices for the sales and finance agents (Q12).
- Meaning of "five-hour limit and follow-ups" for the email cap (Q9).
- Q38: a conversation about who signs off the med spa safety rules, before any Vespera pilot.
- **Phone access (Q11), your steps.** The server and the installable app are ready; the phone itself is yours. In order:
  1. Install Tailscale on the laptop and on the phone and sign in to both with the same account (the build never creates accounts or enters keys).
  2. On the laptop, turn on HTTPS for your tailnet in the Tailscale admin page, then run `tailscale serve --https=443 http://127.0.0.1:3000` and `tailscale serve --https=3100 http://127.0.0.1:3100` (the web app and the API). Do NOT use `tailscale funnel`: that puts it on the public internet.
  3. In `.env` set `LOGIN=on` and `PUBLIC_WEB_ORIGIN=https://<your-laptop>.<your-tailnet>.ts.net`. Leave `BIND_HOST` empty: Tailscale reaches the servers on loopback, so nothing needs to listen on another interface. (If you ever set `BIND_HOST`, the server will refuse to start without login and an https origin.)
  4. Run `pnpm dev`. The server writes a one-time setup code to `owner-setup-code.txt` in your data folder (`~/.conclave-os`). Open the https address on the laptop, go to /login, enter the code and save a passkey. Then on the phone open the same address in Chrome, make a code from the laptop (Devices) for the phone, enter it, and save a passkey there.
  5. In Chrome on the phone choose "Add to Home screen" / "Install app". Check that /approvals opens and that an approval shows which device decided it. The laptop must stay awake for the phone to work.
  The layout on an Android profile is already checked by `pnpm run e2e:mobile`; this step is the real-phone check only you can do. Before you switch on remote access, also set Inngest's signing key (see DECISIONS, S1-10): `/inngest` is not behind the login wall.
- Vercel: log in yourself with the Vercel CLI on the laptop when slice 7 needs it (Q24).

## Eval set (S3-8)

- [ ] The 20 leads in `eval/outreach/leads.json` are made up. When you have real leads in the pipeline, replace them (keep the same fields; the draft must mention the words in `mustMention`), then run `pnpm run eval:baseline --drafts <file>` with drafts from the outreach rep.
- [ ] Say when it is fine to spend plan usage on a real-agent eval run (20 short drafts). Until then the gate runs on stored drafts or the reference drafter, which costs nothing.

## Disk was full (fixed 2026-11-13)

- [x] Cleared by Anees's go-ahead; the cause is fixed and guarded (S3-12). Nothing to do.


