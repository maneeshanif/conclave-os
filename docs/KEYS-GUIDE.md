# Keys and sign-ins: how to get each one, and how to add it

Written 2026-11-20. Add them **one at a time**, in the order below (the first ones switch on the most). After each one, tell me its name and I will test it and say what it unlocked.

## Ground rules (they protect you)

- Keys go in a file named `.env` in the repo folder (copy `.env.example` to `.env`). `.env` is not committed. **Never paste a key into the chat, a task, a role file or a document.** I do not need to see it: I only need to know it is set.
- Where a key is a *name* in `.env.example` (for example `RESEND_API_KEY=`), you type the value after the `=`, save, and restart `pnpm dev`.
- Every key can be thrown away and remade. If one leaks, delete it on the service's website and make a new one.
- Spending: every service below has a free tier or a pay-as-you-go limit. Set a spending cap on the service's website before you add its key.
- A key does not make anything happen by itself. Every outside action (an email, a post, a merge, a call) still waits for your approval in the inbox. That does not change.

## Order, and honesty about what exists in the code

| # | Service | What it unlocks | Real connector in the code today? |
| --- | --- | --- | --- |
| 1 | Resend (email sending) | Approved emails really go out | **Yes.** Add the key and switch the transport. |
| 2 | Anthropic API key | The `claude-agent` runtime (agents without the CLI) | **Yes** (`CLAUDE_AGENT_API_KEY`). |
| 3 | OpenAI API key | The `openai-agents` runtime on a hosted OpenAI model | **Yes** (model alias `openai`; only the key is missing). |
| 4 | GitHub | Approved branches pushed and pull requests opened for real | **Yes, through the `gh` command.** Needs a sign-in, not a key in `.env`. |
| 5 | Apify, Apollo (lead sources) | Real leads and signals | Partly: you can import CSVs today; the connectors are not coded. |
| 6 | LiveKit (video for client meetings) | Real meeting rooms | **No.** The connector is a stub; I need the keys to build and test it. |
| 7 | Vercel | Real deploys | **No.** A stand-in builds locally. |
| 8 | Slack, Jira | Chat sync, tickets | **No.** Stand-ins write to a folder. |
| 9 | Retell, Twilio (phone calls) | Real calls | **No.** Stand-in writes to a folder. |
| 10 | pgvector | Search by meaning in memory | Needs a check on your machine (not a key). |

"No" means: adding the key alone changes nothing. I have to write the real connector, and I only do that once the key exists so I can test it. Tell me the key is in `.env` and I will do it in that order.

---

## 1. Resend (sending email)

1. Go to https://resend.com and sign up (free plan: a few thousand emails a month).
2. Add and verify your **sending domain** (Domains, Add domain). Resend shows DNS records (SPF, DKIM). Add them at the company that hosts your domain's DNS and wait for "Verified". Use a **separate sending subdomain** (for example `mail.yourdomain.com`), not your main domain, so cold email cannot hurt your main mail.
3. API Keys, Create API Key, permission **Sending access**, restricted to that domain. Copy it once (it is shown once).
4. In `.env`:
   ```
   RESEND_API_KEY=re_...your key...
   OUTREACH_TRANSPORT=resend
   OUTREACH_FROM=you@mail.yourdomain.com
   ```
5. Also fill the footer address in `company/COMPANY.md` (a postal address is required for cold email in many countries). Until it is set, every send is refused on purpose.
6. Restart `pnpm dev`. Send-caps (30 in 5 hours, 100 a day) are set on the Settings screen under Sending.

## 2. Anthropic API key (the `claude-agent` runtime)

1. Go to https://console.anthropic.com, sign in, Billing: add a small credit and **set a monthly limit**.
2. Settings, API keys, Create key. Name it `conclave-os`. Copy it once.
3. In `.env`: `CLAUDE_AGENT_API_KEY=sk-ant-...`
4. Do **not** set `ANTHROPIC_API_KEY` for the Claude Code CLI: with it set, the CLI bills the API instead of your plan. The `claude-agent` runtime uses its own variable for this reason.

## 3. OpenAI API key (the `openai-agents` runtime on an OpenAI model)

1. Go to https://platform.openai.com, sign in, Billing: add credit and set a monthly budget.
2. API keys, Create new secret key (restricted permissions if offered). Copy it once.
3. In `.env`: `OPENAI_API_KEY=sk-...` and, if you want a different model than the default, `OPENAI_MODEL=<model name from your OpenAI dashboard>`.
4. In a role file, set the model alias to `openai` and the runtime to `openai-agents`. The key is handed only to runs that use the `openai` alias, never to the local worker. The prompts of those runs leave your machine (that is why the alias is marked remote on purpose).
5. A local model (Ollama) needs no key; that is the default for `local-worker`.

## 4. GitHub (push, pull requests, merge)

No token goes in `.env`. The connector uses the `gh` command, which keeps its own sign-in.

1. Install GitHub CLI: https://cli.github.com (Windows: `winget install GitHub.cli`).
2. In your terminal run `gh auth login`, choose GitHub.com, HTTPS, and sign in with the browser. This is the step only you can do. Use a **dedicated machine-user account or a fine-grained token** if you can, with access to only the repos the agents may touch.
3. In Settings, set **Code host** to `gh`. No restart is needed.
4. Pushes and pull requests still wait for your approval. Merges and repo creation too.

## 5. Lead sources (Apify, Apollo)

- **Apify:** https://apify.com, sign up, Settings, API & Integrations, copy the Personal API token. Set a monthly usage limit. `.env`: `APIFY_TOKEN=...`
- **Apollo:** https://app.apollo.io, Settings, Integrations, API, create a key. `.env`: `APOLLO_API_KEY=...` Credits are limited on the free plan.
- Until I code the connectors, drop a CSV into `POST /api/leads/import`.

## 6. LiveKit (client meeting video)

1. https://cloud.livekit.io, sign up (free tier), create a project.
2. Project settings, Keys, create a key pair. Note three values: the **WebSocket URL** (`wss://...livekit.cloud`), the **API key** and the **API secret**.
3. `.env` (names I will use; they are not read yet): `LIVEKIT_URL=`, `LIVEKIT_API_KEY=`, `LIVEKIT_API_SECRET=`
4. Tell me they are set. I write the connector, a guest-token endpoint and the room view, test with two browser windows, then switch Settings, Meeting rooms, to `livekit`. This also unlocks audio, video and screen sharing in the office.
5. Guest links are served on loopback. For a real client to join you will need the Tailscale step in NEEDS-YOU (Funnel is not allowed).

## 7. Vercel (deploys)

1. https://vercel.com, sign up, install the CLI (`npm i -g vercel`), run `vercel login` yourself.
2. Create a token: Account Settings, Tokens, scope it to one team, short expiry. `.env`: `VERCEL_TOKEN=...`
3. Tell me; I write the real deployer behind the same interface.

## 8. Slack and Jira

- **Slack:** https://api.slack.com/apps, Create New App, From scratch, pick the workspace. Add bot scopes `chat:write`, `channels:history`, `channels:read`. Install to workspace. Copy the **Bot User OAuth Token** (`xoxb-...`) and the **Signing Secret**. `.env` (names I will use): `SLACK_BOT_TOKEN=`, `SLACK_SIGNING_SECRET=`. Reading Slack needs a public URL for events; I will use Socket Mode instead so nothing is exposed (that needs an app-level token, `SLACK_APP_TOKEN=`, with `connections:write`).
- **Jira:** https://id.atlassian.com/manage-profile/security/api-tokens, Create API token. `.env`: `JIRA_BASE_URL=https://yourteam.atlassian.net`, `JIRA_EMAIL=`, `JIRA_API_TOKEN=`.

## 9. Phone calls (Retell, Twilio)

- **Twilio:** https://www.twilio.com, sign up, buy a number, copy Account SID and Auth Token. `.env`: `TWILIO_ACCOUNT_SID=`, `TWILIO_AUTH_TOKEN=`. Calling people for sales has legal rules (consent, do-not-call lists) that depend on the country; the Calls Desk keeps every call behind an approval, and I will not turn on cold calling.
- **Retell:** https://www.retellai.com, sign up, API Keys. `.env`: `RETELL_API_KEY=`.

## 10. pgvector (not a key)

Only needed for search by meaning. In the embedded database it needs the extension files for your operating system. Tell me when you want it and I will run the check on your machine and say exactly what, if anything, to install.

---

## Things that are not keys but only you can do

- **Art:** avatar parts (skin, hair, clothes), themed offices (sci-fi, medieval, nature). Either draw or buy art you have the right to use (Kenney's CC0 packs are fine), or connect Google Flow so I can generate it; tell me which.
- **Real phone access:** the Tailscale steps in `docs/NEEDS-YOU.md`.
- **Company facts:** footer address, offers and prices, in `company/`.
