# Needs Anees

Things the build parked for you. Each says what to do.

- **OpenCode key expired (blocks the OpenCode half of the e2e on this laptop).** The run failed at once with "This API key has expired. Create a new API key in OpenCode Console and replace it in your client or secret store. Signing in again will not renew this key." The build cannot create or replace a key. What to do: open https://opencode.ai/console/account#api-keys, create a new key, and put it where OpenCode keeps its credentials on the laptop (`opencode auth login`, which you run yourself). Then say "retry the OpenCode e2e" and the build runs `pnpm run e2e` again. Nothing was sent to OpenCode: the key was refused before the task text left the machine. Until then the claude-cli half passes and the OpenCode half is the only thing the Windows e2e is missing.
- **Free some memory, then the local model test can run.** `gemma4:latest` needs about 8 GB free to load and the laptop has about 3 GB free with Chrome and VS Code open. Close them (or most tabs), then say "run the local model test". It runs `apps/server/test/real-local-model.test.ts`, which decides whether `gemma4:latest` can be `local-worker`. You can also run it yourself in PowerShell: `$env:CONCLAVE_TEST_OPENCODE='C:UsersHPAppDataRoaming
pm
ode_modulesopencode-aiinopencode.exe'; $env:CONCLAVE_TEST_LOCAL_MODEL='gemma4:latest'; pnpm exec vitest run apps/server/test/real-local-model.test.ts`. It unloads the model when it finishes. `gpt-oss:120b-cloud` is never used for this.
- Windows run, done on this laptop on 2026-11-12: `pnpm install`, `pnpm test` (174 pass), `pnpm run doctor` (passes) and `pnpm run e2e` on Claude Code (passes). `pnpm run e2e` on OpenCode: see the item above.
- Fill the TODOs in `company/COMPANY.md`, including the cold email footer address.
- Cold email footer address and sending domain/service (Q7, Q8). Real sends stay off until both exist.
- Offers and prices for the sales and finance agents (Q12).
- Meaning of "five-hour limit and follow-ups" for the email cap (Q9).
- Q38: a conversation about who signs off the med spa safety rules, before any Vespera pilot.
- On the phone: install Tailscale and Chrome, open the PWA, final check (Q11).
- Vercel: log in yourself with the Vercel CLI on the laptop when slice 7 needs it (Q24).
