# Questions for Anees, all slices at once

Answer in one message, by number. Anything you skip takes the default. Never paste a password or an API key here; keys go in your local `.env`.

## How the build runs

1. **Merging.** One PR per slice into `master`; you merge them. The next slice starts on top of the unmerged one. *Default: yes.*
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
