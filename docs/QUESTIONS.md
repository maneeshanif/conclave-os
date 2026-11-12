# Questions for Anees, all slices at once

**Answered on 2026-11-12. The answers are in the last section, "Answers". They override every *Default* below. Do not ask these again.**

Answer in one message, by number. Anything you skip takes the default. Never paste a password or an API key here; keys go in your local `.env`.

## How the build runs

1. **Merging.** Settled: one branch, `dev`, one PR into `master`, merged when you choose.
2. **Stop rule.** SPEC 18 says not to start a slice until the last one is used every week. Waive it for this run? *Default: waived. Each slice still has to pass its "Done when" check.*
3. **Usage limits.** When Claude Code hits a plan limit, the session stops; you paste the resume prompt after the reset. *Default: yes.*

## Models and machine (slices 0, 4)

4. Which signed-in CLIs, on which plans? (Claude Code on ___; OpenCode on ___ or a local model) *Default: Claude Code on your paid plan; OpenCode on a local model.*
5. Your machine: RAM, GPU (and VRAM), and is Ollama installed? *Default: build against `qwen3:8b` on Ollama.*
6. Does the machine stay on all day for heartbeats and scouts? *Default: yes, while you work; scouts pause when it sleeps.*

## Approvals and outreach (slice 1)

7. Cold email footer: the postal address to print (a virtual mailbox is fine). *Default: none; real sends stay blocked until you give one.*
8. Sending domain and from-address, and the service. *Default: Resend, on a separate domain such as `mail.<yourdomain>`; outbox-only until you add the key.*
9. Daily email cap per channel account. *Default: 20.*
10. Who approves what. *Default: you approve everything; Nimra can approve content and outreach.*
11. Phone access: private network over Tailscale, with a login. *Default: Tailscale + username and password + a device list.*

## Clients and lead gen (slice 2)

12. The two offers and their prices, exactly as they may appear in an email. *Default: the TODOs in `COMPANY.md` stay, and any price in a draft is blocked.*
13. Target markets and ideal client (industry, country, size). *Default: US small businesses; med spas in California for Vespera.*
14. Lead sources: CSV import, Apollo, Google Maps, others? *Default: CSV import plus Google Maps, with Apollo as a connector you switch on.*
15. Sequence: steps and gaps between them. *Default: 3 emails, days 0, 3 and 7; a reply pauses the sequence.*
16. Morning brief: time and where it shows. *Default: 8:30am Karachi time, on the home screen.*

## Reliability (slice 3)

17. The 20 real leads for the eval set: will you give a CSV, or should the builder take them from your first imports? *Default: from the first imports, and you check them.*
18. Daily backup location. *Default: `DATA_DIR/backups`, keeping 14 days.*

## Marketing, browser, video (slice 5)

19. Social accounts to wire up (X, LinkedIn, Instagram handles). *Default: @conclaveai_pro on X only, posts only, no DMs.*
20. Video generation provider. *Default: none; the Video Ideas inbox and scripts only.*
21. Phone notifications. *Default: web push from the home-screen app.*

## The office (slice 6)

22. Art style. *Default: Kenney CC0 top-down tiles, one room per switched-on department plus the Boardroom and the client meeting room.*
23. Does Nimra get her own avatar and login? *Default: yes.*

## Engineering (slice 7)

24. GitHub account or org for agent-made repos, and do you use Vercel? *Default: your account `maneeshanif`, Vercel previews; deploys need your yes.*

## Learning and hiring (slice 8)

25. Hiring level. *Default: H0 (agents propose hires, you approve every one) until a month of scorecards.*
26. Roster cap. *Default: 20 active agents.*
27. The delegate's first mandate. *Default: follow-ups inside an approved sequence, nothing else.*
28. Catalog sources. *Default: Agency Agents first (MIT), then matching Paperclip companies.*

## A product for others (slice 9)

29. The OS's own product name and license. *Default: name TBD; keep the repo private and "all rights reserved" until you decide.*
30. Second company template. *Default: a course creator.*
31. Team-mode database. *Default: Supabase.*

## Client meetings and channels (slice 10)

32. Where meetings run. *Default: LiveKit Cloud (free tier), so a meeting does not depend on your laptop.*
33. Which CRM, if any, and which system is the source of truth. *Default: the OS is the source of truth; HubSpot sync as the first connector, Salesforce second.*
34. Tickets: Jira, Linear, or a help desk (Zendesk, Freshdesk)? *Default: Jira first, then a help desk.*
35. Slack: one workspace with shared channels per client (Slack Connect)? *Default: yes; every agent reply is drafted and waits for your yes.*
36. Recording consent wording for the Note Taker. *Default: "This call is recorded and transcribed for notes. Say so if you'd rather not."*
37. A live AI speaker in client calls. *Default: no, not until the Note Taker has run a month and mock-call evals pass.*
38. Who signs off the med spa safety rules (a practitioner's name). *Default: none yet; Vespera pilots stay blocked until named.*

## Answers (Anees, 2026-11-12)

Where an answer says "research", the builder researches it, writes the choice and the reason in `docs/DECISIONS.md`, and carries on. Where it says "later", park it in `docs/NEEDS-YOU.md`.

**How the build runs**
- 1. One branch, `dev`. One PR. Merged when Anees chooses.
- 2. Every slice must pass its own "Done when" test before the next one starts. The weekly-use stop rule is waived.
- 3. Resume after a usage limit should be automatic if possible. See `docs/AUTOPILOT.md`, "Resuming after a limit".
- 4. Build on the laptop (Windows) by default. The cloud session may do work that needs Linux, a second opinion, or review. Both push to `dev`. Never two sessions on the same task: claim a task in `docs/PROGRESS.md` ("Working now: ...") before starting.
- 5. Laptop: 16 GB RAM, Ollama installed. The builder runs `ollama list`, checks the GPU (`nvidia-smi` or Task Manager) and picks the local model that fits, then logs it. With 16 GB, expect a 7B to 8B model; confirm tool calling works before relying on it.
- 6. The laptop is open for now. The build must also run on a small always-on server later (Linux, Postgres instead of embedded, same code). Keep every path, port and database setting configurable so that move is a config change. Record the move as a slice 9 task.

**Email and approvals (slice 1)**
- 7. Footer address: later. Use the default; real sends stay blocked until it is filled in. Put it in `NEEDS-YOU.md`.
- 8. Sending domain and service: brainstorm later. Outbox only until then.
- 9. Daily cap: 30 emails per day for now, counting first emails and follow-ups. It is a setting (`workspace_settings.email_daily_cap`), expected to change. Also build a per-hour limit and a follow-up spacing rule as settings, because Anees mentioned a five-hour limit and follow-ups; ask him what he means when slice 2 starts the sequences.
- 10. Only Anees. No second user, no Nimra login. Keep roles in the schema for slice 9.
- 11. Phone access: Android. Make the web app an installable PWA, reach it over Tailscale (Android app), behind the login. The builder works out the details and tests with Android Chrome (Playwright device emulation for the layout; the real phone for the final check, listed in NEEDS-YOU).

**Clients and leads (slice 2)**
- 12. Offers and prices: later. The sales and finance departments need agents (sales: SDR, account executive, deal desk; finance: invoicing, collections, expense tracking). Add their templates in slice 2 and write the offer details into `company/` when Anees provides them.
- 13. Markets: US first (most of the work), then Europe, Canada and the Gulf. Store market as a field on leads and campaigns. Keep per-country rules (cold email law, time zones, language) as data, not code.
- 14. Lead sources: CSV, Google Maps, Apollo, Apify, Clay, and more. An agent researches the best sources and connectors per market and proposes them. Each source is a connector (SPEC 8) with its own caps. The builder may also approach larger data providers if a market needs them; propose, do not sign up.
- 15. Sequences: Anees is not sure. Explain it to him in plain words when slice 2 starts, then use the default (3 emails, days 0, 3, 7; a reply pauses it).
- 16. Morning brief: 1:00 pm Karachi time (13:00), configurable.
- 17. Eval set: not sure. Use the default (from the first imports; Anees checks them).
- 18. Backups: keep 90 days.

**Marketing and video (slice 5)**
- 19. Social accounts: all of his accounts (Instagram, X, LinkedIn, Facebook, Reddit and others where clients are). An agent researches where each kind of client actually is. Posting needs approval. No bulk DMs, follows or likes (hard rule 6). Check each platform's automation rules before writing its executor; Reddit especially limits automated posting.
- 20. Video: the local Google Flow MCP is already set up on the laptop. Build the video connector against it; check what it exposes with the laptop session.
- 21. Phone notifications: the builder researches and decides (candidates: PWA web push on Android, a Telegram bot, ntfy). Log the choice.

**Office (slice 6)**
- 22. Anees wants a world like WorkAdventure. The builder may open WorkAdventure in a browser and use the Playwright MCP server to take screenshots for reference of layout and feel. Never copy its code, maps or art (hard rule, AGPL with Commons Clause). Use Kenney CC0 assets or draw our own.
- 23. Add as many roles and rooms as the departments need. Nimra has no avatar for now (see 10).

**Engineering (slice 7)**
- 24. GitHub `maneeshanif`. Vercel: Anees logs in himself on the laptop with the Vercel CLI. Never enter, store or ask for his password or tokens.

**Hiring and learning (slice 8)**
- 25. Roster size: the builder counts from the spec's departments and from what Anees first described (see `areas/conclave-ai-os` ideas in SPEC 1 to 4), and proposes a starting roster.
- 26. Roster cap is a setting, flexible, default 20.
- 27. Delegate mandate: default (follow-ups inside an approved sequence only). The builder lists, in `DECISIONS.md`, every kind of approval that could later be delegated and the risk of each, so Anees can widen it.
- 28. Role sources: Agency Agents first (MIT). The builder searches the wider web for best practice on hiring and evaluating agents and writes what it finds into the spec before building.

**Product for others (slice 9)**
- 29. The builder proposes three names for the OS, with a quick check that each is free as a GitHub org and domain. Anees picks.
- 30. This is the "second company template": a pre-made company folder for a different business (for example a course creator) to prove the OS is not hard-wired to Conclave. Default: a course creator.
- 31. Team-mode database: Supabase.

**Client meetings and channels (slice 10)**
- 32. LiveKit Cloud, with an option to run LiveKit locally (self-hosted) too.
- 33. CRM: HubSpot first, then Salesforce, then others. The OS holds the master copy.
- 34. Tickets: Jira, Linear, Zendesk, Freshdesk and ClickUp, all of them, behind one adapter.
- 35. Channels: Slack first, behind a channel adapter that other channels plug into (WhatsApp, Telegram, Microsoft Teams, email, web chat). Every agent reply to a client waits for approval until Anees widens that.
- 36. Meeting recording: the Note Taker may only record with the consent notice shown to every participant. The wording is configurable per market, but the notice cannot be switched off. The builder does not build hidden recording. Reason: recording people without telling them is illegal in many places (for example two-party-consent US states, and GDPR in Europe and the UK), and it would expose Anees.
- 37. Live voice agent in client calls: yes, wanted. Build it last in slice 10, after the Note Taker works, behind evals with mock calls, and it must tell callers it is an AI. Anees's Speko voice connector may be used.
- 38. Med spa safety rules sign-off: Anees is not sure. Discuss with him in depth before any Vespera pilot. Pilots stay blocked until then.

### Follow-up answers (Anees, 2026-11-12, later)

- **3 (resume).** The builder picks what fits best. Decision: the laptop session runs in `/loop` mode as the main way to resume (it can run Windows tests and Ollama). A cloud scheduled task is the backup only for Linux-side work. Both use the claim line in `docs/PROGRESS.md`.
- **9 (email cap).** The cap is a rolling window: 30 emails per 5 hours, not per day. Build it as settings (`window_hours` = 5, `window_cap` = 30), plus a per-day cap, so Anees can change both later, like Claude Code's own usage window. Follow-ups count in the same window.
- **16 (morning brief).** 13:00 Karachi stays. Anees wakes at 14:00, so this is his morning. Keep it a setting.
- **30 (company templates).** Build the course-creator company template as a real, reusable template folder, so Anees can hand it to another teacher and it works for them with no code change. Write a short `templates/companies/README.md` that says how to install and fill it in.
- **36 (meeting recording).** The consent notice is shown at the very start of every call, before recording begins, and the Note Taker is only on if nobody objects. If any participant says no, the recording stops (or never starts) and Anees gets a notification so he can talk to them. Recording is never silent.
- **38.** Parked in `NEEDS-YOU.md`. Discuss later.
