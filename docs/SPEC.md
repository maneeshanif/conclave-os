# Conclave AI OS: Full Build Spec

Nov 12, 2026 · @Mohummad Anees

jsm-hq and Paperclip are two different layers, and neither covers what you described. Build Conclave AI OS in TypeScript end to end, model-agnostic, with ready-made harnesses as swappable engines, borrowing Paperclip's management rules and jsm-hq's office pattern.

## 1. Verdict

No, jsm-hq is not the same as Paperclip. jsm-hq runs a coding team on one repo. Paperclip runs a whole company of agents. You need the second kind of system with the first one's look.

|  | [jsm-hq](https://github.com/jsmastery-pro/jsm-hq) | [Paperclip](https://github.com/paperclipai/paperclip) | What you need |
| --- | --- | --- | --- |
| Job | A lead agent plans, workers code, each task becomes one branch and one pull request | Org chart, goals, tickets, budgets, approvals and audit for any agents | Departments for sales, marketing, product, research and code |
| Unit of work | A pull request on GitHub | A ticket tied to a company goal | A task that can end as a post, an email, a lead list, a call or a PR |
| Agents | Claude Code or Codex only | Any agent that can take a heartbeat: Claude Code, Codex, Cursor, OpenClaw, bash, HTTP | Ready-made harnesses (Claude Code, OpenCode, Codex) turned into agents by templates, plus Python workers |
| Where it runs | Your machine, each agent in a Docker Sandbox | Node.js server, React UI, embedded Postgres | Node, Postgres, your own machine or a server |
| UI | Pixel-art office drawn with Pixi.js, agent drawers with live terminals | Task-manager dashboard | The office, with departments you click into |
| Approvals | Action items, and it never merges for you | Board approval for hires and strategy, budget hard stops | Your yes before anything is published, sent or spent |
| License | MIT for code. The name and logo are not covered | MIT | Your own code |

**Why jsm-hq alone cannot do it.** Every task in jsm-hq must be a branch and a pull request, and HQ tracks progress by reading GitHub. A LinkedIn post or a lead list has no pull request, so marketing and outreach have nowhere to live.

**Why I would not run Paperclip as the core.** It would work, and it is the fastest way to a running company. But it brings its own UI and data model, and you want your own office, your own client and campaign records, and a harness you control.

**Conclave OS against Paperclip.** Paperclip is a good product, it ships today, and it now does more than it did when v1 of this spec was written: evals, a skill studio with version history, performance reviews, cloud sandboxes, single sign-on, many users and a catalog of 16 companies with 440 agents. Do not try to beat it at being a general agent manager. Beat it at the thing it is not built for: running a sales-led business from first lead to paid invoice.

| What a founder needs | Paperclip, from its README and roadmap | Conclave OS |
| --- | --- | --- |
| Clients and revenue | Tasks, goals and connectors to other tools. No CRM of its own | Accounts, contacts, deals, both funnels as stages, campaigns, a unified inbox and invoices, all in the same database the agents use |
| Goals | Goal ancestry gives agents the "why" behind a task | The goal ladder works backwards from revenue to the daily activity each department owes, and the Goals screen shows required against actual |
| Outside actions | Approval gates, and gateway actions set to Allowed, Ask first or Off | The model can only propose. Plain code sends, exactly once, with send caps, a suppression list and blocked claims checked on the server |
| Finding demand | Up to you | Demand Radar, the Micro-SaaS Lab and Research rooms built in, each feeding leads or ideas into the pipeline |
| Hiring | Approve hires, install ready-made teams, agent reviews | A weekly gap check, a talent catalog searched by meaning, a bake-off between candidates, trials, scorecards, a bench and a roster cap |
| Learning | Memory and knowledge in progress. Automatic organisational learning and self-organisation not started | Reflect after runs, approve-and-teach from your edits, skills that patch themselves with your approval, a monthly audit |
| Acting for you | Not offered | A delegate with a signed mandate and its own ledger (section 6) |
| Meetings | Not offered | The Boardroom: stand-ups, weekly reviews and discussions where every claim cites a number, ending in a decision log |
| Content and video | Not offered | Content calendar, browser posting with a screenshot in the record, the video studio |
| The interface | A task-manager dashboard and a mobile view | A walkable office, and the same data as plain screens and a phone app |
| Model lanes | Any agent, any model | Any agent, any model, plus an all-day local lane and clean pausing when a plan limit is hit |
| Their companies | Import and export of whole companies | Imports Paperclip's company format too, so its 16 companies are a hiring pool here |

Where Paperclip stays ahead, and where you should not compete: many human users with single sign-on and roles, hosted sandboxes, a skill studio, document comments, company-wide search, a community and a team behind it. The OS borrows ideas from it and reads its format.

The honest answer to "why not just use Paperclip" is not a longer feature list. It is a working business on it. An office of 167 idle agents and no revenue is what people would laugh at. Rung one of the goal ladder, earned through this OS, is what ends the argument.

**Decisions in this version (v5)**

| Question | Decision | Why |
| --- | --- | --- |
| Language | TypeScript for the whole core: API, harness host, executors and UI | One language and shared types from database to canvas. Remotion video, the Phaser office and both MIT reference codebases (jsm-hq, Paperclip) are TypeScript. It installs with one command |
| FastAPI | Not in the core. Python agents join as workers over the HTTP adapter | Same shape as the book: Paperclip is a Node server that hires Python workers through its `http` adapter |
| Agents | Ready-made harnesses plus templates. No custom agent code | Your call, and it is also how Paperclip works: an agent is a role, a manager, a budget and an adapter to a coding agent you already have |
| Harness | No single harness. One runtime contract with several engines behind it: Claude Code and OpenCode as signed-in CLIs, the OpenAI Agents SDK in-process for any model, and the Claude Agent SDK with API keys later | Anthropic does not support Claude Code on non-Claude models, so a Claude-only engine would tie the OS to one vendor. Nothing above the runtime changes when you switch |
| Models, in three stages | Now: signed-in Claude Code and OpenCode. Next: a local model running all day for scouting and triage. Later: API keys | Fits your budget today and keeps the upgrade path open |
| Workflows | Inngest | The book's nervous system. Its retries, waits and concurrency limits also keep runs inside your machine's memory |
| Tenancy | Every row belongs to a workspace from day one | You can hand the OS to a teacher or a client without a rewrite |

**What changed from v1.** v1 put a Python FastAPI service and the OpenAI Agents SDK at the centre, because that was the ask. You then made three requirements firm: a harness equal to Claude Code and Cowork, built-in plugins and connectors, and a product other people can install. Those three move the core to TypeScript and the engine to the Claude Agent SDK. A Python agent built with the OpenAI Agents SDK can still join as a worker through the http runtime.

**What changed in v3.** Agents are no longer built with an SDK at all: every agent is a ready-made harness plus a template (section 5). The start is subscription-first, with a local model next and API keys later (section 7). The learning loop now mirrors Hermes part by part (section 9). Section 10 gains the two sales funnels, section 4 gains two rooms that scout for demand and for better ways of working, and section 11 maps the book's kinds of record onto the OS.

**What changed in v4.** You asked for the OS to be model-agnostic, and for the OpenAI Agents SDK if Claude Code is not. It is not: Anthropic's docs say it does not support routing Claude Code to non-Claude models. So no harness is the engine any more. The runtime contract is, and each harness is one engine behind it. OpenCode moves into slice 0 as the model-agnostic CLI harness, and the OpenAI Agents SDK joins in slice 4 as the in-process engine for local and API-key models. The parts of Claude Code worth borrowing (a rules file, skills, permission rules, tools through MCP) are supplied by the OS to every engine, so they survive a change of engine (section 5, the portability rule). Agents are still templates: the SDK powers one generic runner, and nobody writes agent code.

**What changed in v5.** Three things you asked for. The company can now hire from a talent catalog of hundreds of ready-written roles, starting with the MIT-licensed Agency Agents collection, and it runs a bake-off before a hire (section 9). The office becomes a WorkAdventure-style world you walk around in, drawn with Phaser and Tiled maps (section 12). And section 4 grows from eleven departments to eighteen, so the company has the same divisions a real agency has. The table below says honestly where the OS goes further than Paperclip and where Paperclip is still ahead.

**Is TypeScript more reliable?** Not by itself. Reliability comes from the harness and the workflow engine, and both exist in either language. TypeScript wins here on fit. Memory use is not a language question either, and section 17 shows where it really goes.

**The cost of this choice.** Full custom is a large build for one developer. Section 18 orders the work so slice 1, a lead to an approved and sent email, is usable before the office UI exists.

## 2. At a glance

Five layers, read top to bottom. You work in the top layer, agents run in the middle, and everything is recorded in the bottom one.

&#91;embedded content: system layers · 5 layers, 16 parts\]

The approval gate, the highlighted box, is the only path the OS gives an agent to the outside world, and permission rules deny the others. An agent in the harness can read and draft freely, but a post, a message or a deploy starts as a proposal, waits for you, and is then carried out by plain code.

## 3. What the OS does

Conclave AI OS is one place where you, as founder, run a company of AI agents that sell to two markets, and where nothing leaves the building without your yes.

**The two markets**

- **Services:** small businesses that want websites, automations, chat agents and CRM work. Med spas stay the focus of cold outreach. Public pages stay broad.
- **Product:** Vespera AI. The job now is customer conversations first, then the production build, then launch.

**The three things you see**

1. **The office.** A floor with one room per department. Agents sit at desks and show what they are doing. Click a room to open the department. Click an agent to open its drawer.
2. **The approvals inbox.** Every post, message, hire, skill change, spend and merge waits here as a card with a preview. You approve, edit or reject. This is the most important screen in the product.
3. **The dashboard.** Leads found, messages sent, replies, meetings booked, calls made, content published and money spent, by department and by week.

**The rules the whole system obeys**

- Agents draft and prepare. You decide. Publishing, sending, spending and deploying always pass through an approval.
- Every task traces back to a company goal, so an agent always knows why it is doing something.
- Every run is logged: who did what, with which tool, at what cost.
- Every agent has a monthly budget. When it is spent, the agent stops.
- The company learns. Lessons become memory or skills, and skill changes also come to you for approval.

**What it is not.** It is not a bot farm for mass DMs, and it does not hold your passwords. Section 15 explains why both would end the accounts you just created.

**The goal ladder.** The company works backwards from one money goal at a time. You set the ladder, and every department goal and every task hangs from the current rung.

| Rung | Target | Where the money comes from | What has to be true first |
| --- | --- | --- | --- |
| 1 | $1,000 in the first month | Services: one or two small fixed-scope builds from the services funnel | An offer and a price written down, a way to invoice and receive payment from abroad, and selling started this week by hand |
| 2 | $3,000 to $5,000 a month by month three | Retainers from rung 1 clients, more builds, and the first paid Vespera pilot | An outcome note and an introduction from every client, and one pilot signed |
| 3 | $25,000 a month | Vespera subscriptions as the main line, with services as the feeder | A pilot that met its target, a named case, and a funnel that repeats |

This is the route the book lays out for a solo builder: freelance engagements fund the build, the first proven engagement opens doors, and the product then carries most of the revenue.

**Working backwards.** The Goals screen turns the current rung into the daily activity it needs:

```text
goal this month              $1,000
÷ average first build        = builds needed
÷ concept-to-build rate      = free concepts needed
÷ reply-to-concept rate      = replies needed
÷ reply rate                 = first touches needed
÷ working days left          = first touches per day
```

You enter planning guesses for the rates at the start. After two weeks the OS replaces them with your own numbers from the pipeline, and every morning it shows required activity against actual.

```yaml
# company/goals.yaml  (example values, set your own)
north_star: monthly revenue from clients who would recommend us
ladder:
  - { id: rung-1, target_usd: 1000,  by: 2026-12-12, source: services }
  - { id: rung-2, target_usd: 4000,  by: 2027-02-12, source: services+pilot }
  - { id: rung-3, target_usd: 25000, by: null,       source: product }
department_goals:
  lead-gen:  { metric: qualified_leads_per_week,  serves: rung-1 }
  outreach:  { metric: positive_replies_per_week, serves: rung-1 }
  engineering:  { metric: concepts_delivered_per_week, serves: rung-1 }
  product:   { metric: slice_sessions_per_month,  serves: rung-2 }
```

**Two limits to plan around.** The book's own planning figure for a first sale is one to three months, and it says the buyer sets that clock. So $1,000 in month one is a stretch target, and the numbers you control are the daily ones: touches, replies, concepts and calls. Second, the OS will not earn rung 1, because most of it will not exist yet. Rung 1 comes from the services funnel run by hand with the email skill you already have, while slices 0 to 2 are built alongside.

**Your time as CEO.** The company is designed to run while you are busy, on a fixed attention budget.

| When | What reaches you | Budget |
| --- | --- | --- |
| Every morning | One brief on your phone: yesterday against the goal, every approval batched into one list, and at most three questions | 15 minutes |
| Every week | The Boardroom review (section 4) | 45 minutes |
| Every month | The skills and memory audit, budgets, and the delegate's mandate | 1 hour |

The delegate clears routine approvals between those points, and nothing interrupts you outside them except a failed executor or the kill switch. Some work stays yours however good the agents get: sales calls and slice sessions, pricing and signing, receiving money, and the relationships behind introductions.

## 4. Departments

Eighteen department rooms and a boardroom. Each department has one lead agent and one to three workers. Start with rooms 0, 2 and 1 and add the rest in the order of section 18. A department that is switched off costs nothing: it has a room on the map, a row in the table and paused agents.

| # | Department | Agents | What it produces | Main tools | Needs your yes |
| --- | --- | --- | --- | --- | --- |
| 0 | Chief of Staff | One lead | Morning brief, weekly plan, task hand-offs between rooms, gap check for missing skills or hires | Database, task board | New hires, weekly plan |
| 1 | Lead Gen | Prospector, Enricher, Scorer | Scored lead lists with site, email, Instagram and Facebook links | Apollo, Clay, Apify, Google Maps | Paid enrichment over a credit cap |
| 2 | Outreach | Site Auditor, Copywriter, Follow-up | Cold emails from your `clinic-homepage-outreach` skill, DM drafts for X and Instagram, follow-ups, reply triage | Web fetch, Gmail drafts, CRM tables | Every first message. Follow-ups only inside an approved sequence |
| 3 | Marketing and Content | Researcher, Hook Scout, Writer, Video Maker, Publisher | Posts for LinkedIn, X and Instagram, videos made from your own ideas and from researched hooks, a weekly content calendar | YouTube and web research, brand skills, Remotion, browser | Every post and video before it goes out |
| 4 | Product (Vespera) | Discovery, Spec Writer | Interview scripts, call notes, feature specs, the production build backlog | Interview and spec skills, call transcripts | Specs before they reach Engineering |
| 5 | Engineering | Tech Lead, Coders, Frontend Studio | Pull requests for Vespera and client work, GSAP and Lenis demo sites, homepage concepts | Claude Code, Codex, jsm-hq, GitHub, Vercel | Every merge and every deploy |
| 6 | Micro-SaaS Lab | Problem Scout, Analyst, Builder | Recurring problems people describe on Reddit, X and YouTube, grouped and scored. A weekly brief that says "build this", with the evidence links. Small MVPs for the ideas you pick | Apify, web search, Engineering hand-off | Which idea gets built |
| 7 | Founder Network | Finder, Relationship Keeper | Early US and Canada founders worth knowing, a note on each, message drafts in your voice, reminders | X and LinkedIn research, CRM tables | Every message. You send these yourself |
| 8 | Calls Desk | List Builder, Call Prepper, Voice Agent | Daily call list with a one-line opener per lead, call notes, booked meetings | Retell AI, Twilio, CRM tables | Every outbound AI call campaign |
| 9 | Demand Radar | Scout, Qualifier, Reply Drafter | Public posts where someone is asking for the services you sell, on Reddit, X, forums and job boards. Each becomes a qualified signal, then a lead with a drafted reply | Apify, web search, Upwork, CRM tables | Every reply. You post these yourself |
| 10 | Research | Tool Scout, Video Learner, Improver | A weekly digest of new tools, models, harness features and techniques from the industry and from YouTube. Improvement proposals for skills, templates, plugins and coding practice, each with the expected gain and a test | Web search, YouTube transcripts, Context7, the eval sets | Every change it proposes |

**Rooms 9 and 10 are configured now and switched on later.** Their templates, rooms and tables exist from the start, with the agents paused, so turning them on is a setting. The scouts in rooms 6, 9 and 10 are the first agents to move to the all-day local model.

**Room 11 is the Boardroom.** It has no agents of its own. You, the Chief of Staff and the department leads meet there, and it is where the company is steered.

| Meeting | Who | What happens | What comes out |
| --- | --- | --- | --- |
| Daily stand-up, in writing | Leads post, you read | Each lead gives yesterday's number, today's plan and one blocker | The morning brief |
| Weekly review | You, the Chief of Staff and every lead | Each lead presents its number against the goal, its lessons and missteps, and up to three proposed changes. Leads question each other's numbers, the way a sales team reviews a pipeline | Decisions, each with an owner and a date, turned into tasks |
| A discussion you open | You and the leads you pick | You state the question. Each lead answers in turn with evidence from its own tables, for up to three rounds. The Chief of Staff then writes the options | Your decision, or a research task |

A discussion is a stored thread, and each turn is an ordinary run with the thread as context, so it uses the same harness as everything else. Two rules keep it useful. A lead must cite a number or a record for any claim. And the Chief of Staff's summary must show where the leads disagree, not smooth it over. Every decision lands in a decision log that agents read before proposing something you already rejected.

**How work moves between rooms.** Lead Gen hands a scored lead to Outreach. Outreach hands a reply to you or to the Calls Desk. A "yes" from a clinic becomes a task for Frontend Studio. Product hands approved specs to Engineering. The Micro-SaaS Lab hands an approved idea to Engineering. Marketing takes finished work from every room and turns it into posts.

**The Founder Network room.** The agents research and draft, and you send from your own account in your own words. Say what Conclave does early in the relationship. People introduce you to clinics more readily when they know what the introduction is for.

**Rooms 12 to 18, added in v5.** These match the divisions a real agency has, and the divisions the talent catalog is sorted by, so a hire for any of them has candidates waiting.

| # | Department | Agents | What it produces | Main tools | Needs your yes |
| --- | --- | --- | --- | --- | --- |
| 12 | Talent | Recruiter, Performance Reviewer | The weekly gap check with the Chief of Staff, catalog searches, bake-offs between candidates, trial reports, weekly scorecards for every agent, the bench | The talent catalog, eval sets, run history | Every hire made active, every termination |
| 13 | Design Studio | Brand Guardian, UI Designer, Visual Storyteller | Brand kits for clients, homepage concept designs before Frontend Studio builds them, social graphics, thumbnails | Image generation, Figma, brand skills | Anything a client will see |
| 14 | QA and Testing | Test Runner, Accessibility Checker, Evidence Collector | A test report with screenshots for every client site and every Vespera release before deploy, plus the nightly eval runs | Playwright, the eval sets, Lighthouse | Nothing. Its report is attached to the deploy approval |
| 15 | Client Success | Onboarding Lead, Support, Account Strategist | Onboarding checklists, drafted support replies, monthly client reports, renewal and upsell plans | CRM tables, the inbox, project records | Every message to a client |
| 16 | Finance and Ops | Bookkeeper, Invoicer, Analyst | Draft invoices from won deals, overdue reminders, spend against budget, revenue against the goal ladder, a monthly profit and loss | Invoice and payment connectors, the ledger | Every invoice sent and every payment |
| 17 | Paid Media | Ads Strategist, Creative Tester | Ad plans, copy and creative variants, weekly results against cost per lead | Ad platform connectors, Design Studio hand-off | Every dollar of ad spend |
| 18 | Security and Compliance | Compliance Auditor, Security Reviewer | Checks of outreach against email and calling rules, a review of each pull request for leaked secrets and risky dependencies, the safety rules file for Vespera | The proposal handler's rule sets, dependency scanners | Changes to any rule set |

Rooms 12 and 14 switch on with slice 8 and slice 7. Rooms 15 and 16 switch on once the first client signs, because before that they have nothing to do. Room 17 waits until there is revenue to spend. Rooms 13 and 18 switch on with slices 5 and 7.

## 5. The harness

The harness is the part you said cannot be compromised, so the OS does not write its own loop. It runs ready-made ones behind one contract (section 7) and adds the company layer around them: Claude Code and OpenCode headless on the accounts you are signed in to, and the OpenAI Agents SDK in-process for any model reached through an API key or a local endpoint. The parity table below describes the Claude Code engine. The portability rule at the end of this section says what must hold on every engine.

**Why the harness matters more than the model.** The Agent Factory book puts it as Agent = Model + Harness, and gives the arithmetic. If each step succeeds 95% of the time, a 20-step run finishes cleanly only about 36% of the time. A better model lifts the 95 a little. The harness attacks the chain: verification catches a bad step early, recovery resumes instead of restarting, and constraint limits what a bad step can cost. The book names four necessary parts: an agent loop, a tool interface, context management and control mechanisms.

**Parity with Claude Code and Cowork**

| What they give you | Where it comes from in the OS |
| --- | --- |
| Agent loop with tool calling | Claude Code's own loop |
| Built-in tools: read, write and edit files, run commands, search the web | Claude Code's built-in tools, limited to the agent's own workspace folder |
| Context management: compaction, subagent isolation, a rules file | Claude Code, plus a generated `CLAUDE.md` per agent from its role, company rules and lessons |
| Skills that load only when needed | `.claude/skills` in the agent's workspace and skills inside plugins |
| Plugins that bundle skills, subagents, hooks and MCP servers | Claude Code loads plugins. The OS keeps a plugin registry and installs them per agent |
| Connectors | MCP servers from the registry, granted per agent |
| Subagents | Claude Code subagents for short fan-out inside one run. Durable hand-offs go through tasks |
| Hooks | A policy hook before every tool call and a logging and checking hook after it |
| Permissions | Autonomy levels mapped to permission rules |
| Sessions you can resume | Session id stored on the task, so work continues across days |
| Scheduled tasks | Inngest cron heartbeats |
| Working in folders and repos | Each project is a registered folder. Coding tasks get a git worktree |
| Files and deliverables | Workspace folder, a deliverables table and file storage |
| Sandboxing | The book's harness and sandbox split: generated code runs away from secrets. Locally that is a fenced folder plus permission rules, with Docker or E2B as the stronger option |

**What the OS adds on top**

Every run goes through the same eight steps:

1. **Wake.** A heartbeat, an assigned task, a message, or an outside event such as a reply.
2. **Check out one task** with an atomic database update, so two agents never do the same work.
3. **Build context.** Role file, the task and its parent goal, matching lessons from memory, and the list of granted skills, plugins and connectors.
4. **Plan.** For anything beyond one step, the agent writes its plan into the task thread first.
5. **Act.** Read tools and internal writes run. Anything with an outside effect is a `propose_*` tool that only creates an approval card.
6. **Verify.** The output must pass its check before it counts: a schema, a command, or a second agent acting as reviewer.
7. **Report.** Result to the task thread, follow-up tasks to other agents, task marked done or blocked with a reason.
8. **Reflect.** A short pass decides whether the run taught anything worth keeping (section 9).

**How a weak model is made more capable.** These are harness levers, and they work for any model:

- **Small typed steps.** Ask for one thing at a time, in a fixed shape that code can check.
- **Code before model.** Anything that can be a plain function is one. The model is used only where judgment is needed.
- **Skills as procedures.** A weak model follows a written procedure far better than it invents one.
- **A check after every step,** with one repair attempt that shows the model its own error.
- **Escalation.** A cheap or local model tries first. If the check fails twice, the same step reruns on a stronger model.
- **Checkpoints.** A failed run resumes from the last good step.

A limit to state plainly: a small local model in a good harness is still far weaker than a frontier model on long tool chains. The levers above narrow the gap for routine work. They do not close it for planning or writing.

**How agents talk.** Through comments on a task, hand-off tasks, and stored direct messages. You can message any agent from its drawer, and your message becomes its next trigger.

**When an agent is stuck.** It calls `ask_founder` with one specific question, marks the task blocked, and moves to its next task.

**The role file.** Each agent is one folder. The role file is its job description:

```markdown
---
id: outreach-copywriter
name: Copywriter
department: outreach
reports_to: outreach-lead
runtime: claude-cli             # or opencode, openai-agents, codex, http
model: writer                   # an alias from config/models.ts
fallback_model: strong-writer   # used when a check fails twice
heartbeat: "0 9 * * 1-5"
monthly_budget_usd: 10
autonomy: 1                     # see section 6
plugins: [outreach-kit]
skills: [clinic-homepage-outreach, brand-voice]
connectors: [os, web-fetch, gmail-drafts]
max_turns: 25
output_check: schemas/cold-email.ts
---

# Role
You write Conclave AI's first-touch emails to clinic owners.

# How you work
- One task = one lead. Read the audit findings on the task before writing.
- Use only findings the Site Auditor marked verified. Never invent one.
- Keep the email under 170 words. One call to action.
- When the draft is ready, call propose_email. Do not ask for approval in chat.

# When to stop and ask
- Fewer than two verified findings.
- The lead is on the suppression list.
- Anything medical, legal or about pricing.
```

**The role file is the source of truth.** The loader copies its front matter into the `agents` table: `model` becomes `model_alias`, `heartbeat` becomes `heartbeat_cron`, and `fallback_model`, `max_turns` and `output_check` have their own columns. Changing an agent from the UI rewrites the file and reloads it. Only status and spend live in the database alone. `runtime` is one of `claude-cli`, `opencode`, `openai-agents`, `codex`, `http` or `claude-agent`.

**Agents are templates, not code.** You said no custom agents, and that is the right call. An agent is a ready-made harness plus a filled-in template. Nobody writes agent code.

| Piece | What it is |
| --- | --- |
| Harness | A coding agent you already have signed in: Claude Code, OpenCode, Codex. For local and API-key models, the OpenAI Agents SDK runner. Later the Claude Agent SDK, or a Python worker |
| Template | A reusable frame for one kind of job, kept in the repo |
| Instance | The template filled in for one department: a role file and a working folder |

```text
templates/agents/writer/
  template.yaml          # parameters and defaults: runtime, model alias, autonomy 0, budget, heartbeat
  AGENT.md.hbs           # the role file with slots: department, audience, voice, limits
  RULES.md.hbs           # standing rules. Rendered as CLAUDE.md, as AGENTS.md, or into the instructions
  permissions.yaml       # neutral permission rules, rendered into each harness's own format
  connectors.yaml        # connectors this kind of agent needs
  skills/                # skills that ship with the template
  checks/output.ts       # the output check
  trial/                 # one trial task and the probation plan
  evals/                 # cases any change to this template must pass
```

**Default permissions.** A template's `permissions.yaml` gives no shell and no network-writing tool to any agent except the coder and the code reviewer, and those two run in a git worktree with no secrets in their environment. The renderer writes these rules in each harness's own format. This is what makes the approval gate the only way out. A prompt alone would not.

Starter templates: lead, scout, researcher, analyst, writer, reviewer, outreach rep, coder, code reviewer, designer, video maker, chief of staff, delegate, deal desk and client success. Fifteen frames are the starting set. A role with no close frame gets a new template through step 5 below.

**How a new agent is made**

1. **A request.** From you, or from the Chief of Staff after a gap check.
2. **Claude Code fills the template.** A hiring run with a `hire-agent` skill picks the closest template and fills in its parameters. It writes prose, never code.
3. **You see a card.** The OS renders the template into the company folder and shows the role file, tools, budget and trial task.
4. **On approval,** the OS creates the working folder, registers the agent at autonomy 0 and queues the trial.
5. **If no template fits,** the same run drafts a new template from the nearest one. A new template is its own approval and must arrive with a trial and eval cases.

**How Paperclip does the same thing.** From the book's Paperclip chapter: an agent there is a role, a manager it reports to and a budget, powered by a model through an adapter. Local adapters run whatever coding agent you are logged in to, such as Claude Code, OpenCode, Codex or the Gemini CLI, so no separate API key is needed. A hire waits in pending approval until you approve it, and a whole company exports as a `COMPANY.md` plus an `AGENT.md` per role. The OS keeps all of that and adds the template library, plugins, output checks and trials.

**The runner.** A sketch, not yet run. Check each CLI's `--help` for its current flags.

```ts
// runtimes/cli.ts: one runner for every signed-in CLI
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolveModel } from '../config/models';
import type { RunRequest, RunEvent, Runtime } from './types';

const commands: Record<string, (r: RunRequest, model: string) => [string, string[]]> = {
  'claude-cli': (r, model) => ['claude', [
    '-p', r.taskInput,
    '--output-format', 'stream-json', '--verbose',
    '--model', model,
    '--append-system-prompt', r.instructions,          // per-run context only
    '--mcp-config', `${r.workspaceDir}/.mcp.json`,
    '--strict-mcp-config',                             // ignore your personal connectors
    '--allowedTools', r.allowedTools.join(','),
    '--max-turns', String(r.maxTurns),
    ...(r.sessionId ? ['--resume', r.sessionId] : []),
  ]],
  opencode: (r) => ['opencode', ['run', '--format', 'json', r.taskInput]],
  codex:    (r) => ['codex', ['exec', '--json', r.taskInput]],
};

export const cliRuntime = (name: string): Runtime => ({
  name,
  async *start(req: RunRequest): AsyncIterable<RunEvent> {
    const model = resolveModel(req.modelAlias);
    const [bin, args] = commands[name](req, model.name);
    // A clean environment. The agent has tools, so it must never inherit the server's secrets.
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG, ...model.env };
    const child = spawn(bin, args, { cwd: req.workspaceDir, env });

    for await (const line of createInterface({ input: child.stdout })) {
      const event = toRunEvent(name, line);              // maps each CLI's JSON to RunEvent
      if (event) yield event;                            // a plan-limit message becomes kind: 'limit'
    }
    const code: number = await new Promise((done) => child.on('close', done));
    if (code !== 0) yield { type: 'error', kind: 'runtime', message: `exit ${code}` };
  },
  async send() { /* resume the session with the new message */ },
  async cancel(runId) { /* kill the child process for runId */ },
  async health() { /* run `<bin> --version` and a signed-in check */ return { ok: true }; },
});
```

**Three things this runner must get right**

- **A clean environment.** The child gets `PATH`, `HOME`, `LANG` and the model's own settings, nothing else. If an API key were ever in the environment, the CLI could also bill the API instead of your plan.
- **Working folders outside the repo.** Claude Code reads `CLAUDE.md` files from parent folders. An agent folder inside this repo would load the build rules meant for you. So agent folders live under the data directory, outside the repo (section 13).
- **Only its own tools.** The strict flag and the allowed-tools list keep your personal settings and connectors out of a company agent's run.

**How grants reach a CLI.** A CLI does not load a plugin because a role file names it. The renderer materialises each grant into the agent's working folder: a granted plugin's skills go into `.claude/skills`, its hooks into `.claude/settings.json`, and its MCP servers into `.mcp.json`. Standing rules live in the rendered `CLAUDE.md` and change only when the agent is rendered again. Per-run context, meaning the task, its goal and matched lessons, goes in the appended system prompt. That is the Claude Code target. The portability rule below gives the other two.

When you add API keys, the `claude-agent` runtime is added beside this file. The folders stay the same.

**The portability rule.** No engine is load-bearing. Anything that must hold on every run is done by the OS, and each harness's own features are a second layer.

| What an agent needs | Claude Code (`claude-cli`) | OpenCode (`opencode`) | OpenAI Agents SDK (`openai-agents`) |
| --- | --- | --- | --- |
| Standing rules | Rendered `CLAUDE.md` | Rendered `AGENTS.md`. OpenCode V2 reads only that file | Part of the `instructions` string |
| Role and per-run context | Appended system prompt | An agent file in `.opencode/agents/`, plus the prompt | The `instructions` string |
| Skills | `.claude/skills` | The same `.claude/skills` folder, which OpenCode also reads | The OS skill loader: descriptions in the instructions and a `load_skill` tool |
| `os` tools and connectors | `.mcp.json` | `opencode.json`, under `mcp.servers` | MCP servers handed to the agent over HTTP |
| Permissions | `.claude/settings.json` and the allowed-tools list | `permissions` rules in the agent file | The agent has only the tools the runner gives it |
| File tools and a shell | Built in | Built in | Not in the plain runner. The SDK's sandbox agents add them, and the OS leaves that for later |
| Resume | Built in | Built in | Sessions kept by the OS. Tasks stay short and turns are capped |

Three rules follow from the table.

1. **Enforce on the server.** The approval gate, budgets, the suppression list and the blocked-claims check live in the `os` server's handlers and in the executors. They work the same whichever engine made the call. A harness hook or permission file is a second layer, never the only one.
2. **Keep one neutral source.** A template holds its rules, permissions, connectors and skills once, in neutral files. The renderer has one target per runtime and writes each harness's own format. Skills stay in the open Agent Skills format, which Claude Code and OpenCode both load.
3. **Test every engine the same way.** A runtime may be used only after it passes the conformance tests: it emits the run events in order, calls an `os` tool with its run token, is refused a tool it was not granted, receives no secret except its own model settings, stops on cancel, maps a plan limit or a sign-in failure to the right error kind, and either resumes a session or says it cannot.

**What is borrowed from Claude Code.** You asked for a hybrid: take what the Claude side has and give it to the OpenAI Agents SDK. The table is that hybrid. The rules file, skills, permission rules, tools through MCP and the approval gate are supplied by the OS, so the SDK runner gets them without a rewrite. What it does not get is built-in file tools, a shell and long-run context handling. For that reason it runs the short jobs and the CLI harnesses run the long ones.

**One trap per engine**

- **Claude Code** reads `CLAUDE.md` from parent folders, so working folders live outside the repo.
- **OpenCode** combines every `AGENTS.md` from the working folder up to your home folder with its global one. Keep personal rules out of those files, or give agent runs their own config folder.
- **The OpenAI Agents SDK** runs inside the server process. It shares the server's memory, and the runner must hand it one model key and nothing else.

## 6. Approvals, autonomy and the delegate

The model never holds the send button. It can only propose, and plain code acts after you approve.

**Autonomy levels, set per agent in its role file**

| Level | The agent may | Example |
| --- | --- | --- |
| 0 | Read, draft, and comment on or complete its own task | A new hire on trial |
| 1 | Also write to internal tables and hand off tasks | Most agents on day one |
| 2 | Also propose outside actions. Each proposal needs an approval | Publisher, Outreach |
| 3 | Proposals inside a written envelope you approved once are approved by policy code | Follow-up 2 of an approved sequence, to an approved list, under a daily cap |

At every level an executor performs the action, never the agent. Level 3 is a fixed rule with no judgment in it. The delegate, described below, is different: it decides case by case inside its mandate.

**What always needs your approval, at every level**

| Action | What the card shows |
| --- | --- |
| Publish a post or video | Final text, media preview, account, time |
| First message to a new person, on any channel | Recipient, full message, the findings it rests on |
| Spend money or credits above the cap | Amount, vendor, what it buys |
| Hire, retire or change an agent | Role file diff, budget, trial task |
| Create or change a skill | Diff of the skill file |
| Merge or deploy code | PR link, checks, preview URL |
| Start an AI call campaign | List, script, hours, cap |

**How the gate is built.** A proposal tool writes a row and sends an event. A durable workflow waits for the decision, then runs the real action as a plain function. This is the wait-for-event pattern the book uses for refunds, so the wait survives restarts and costs nothing while it sleeps.

**How a CLI agent reaches these tools.** For CLI runtimes the `os` server is an HTTP MCP endpoint on the OS server, bound to 127.0.0.1. Before each run the runner writes a short-lived token for that run into the agent's `.mcp.json`. The server resolves the token to its workspace, agent, run and task, and refuses any call without one. So an agent can only touch its own task. `os-core` is the plugin folder that carries this connector entry and the policy hook. The code below shows the Agent SDK form used later. The handler is the same in both.

```ts
// harness/os-tools.ts: the only way an agent can reach the outside world
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { approvals } from '../db';
import { inngest } from '../workflows/client';

export const proposeEmail = (req: RunRequest) =>
  tool(
    'propose_email',
    'Queue a cold email for approval. Does not send.',
    { leadId: z.string(), subject: z.string(), bodyText: z.string(), bodyHtml: z.string() },
    async (payload) => {
      const row = await approvals.create({
        workspaceId: req.workspaceId, kind: 'email.send',
        agentId: req.agentId, runId: req.runId, taskId: req.taskId, payload,
      });
      await inngest.send({ name: 'approval/requested', data: { approvalId: row.id } });
      return { content: [{ type: 'text', text: `Queued as ${row.id}. Do not retry. Move to your next task.` }] };
    },
  );
```

```ts
// workflows/approval-gate.ts
import { inngest } from './client';
import { approvals } from '../db';
import { runAction } from '../actions';        // deterministic executors, no model

export const approvalGate = inngest.createFunction(
  { id: 'approval-gate', retries: 0 },
  { event: 'approval/requested' },
  async ({ event, step }) => {
    const { approvalId } = event.data;

    const decision = await step.waitForEvent('await-decision', {
      event: 'approval/decided',
      timeout: '3d',
      if: `async.data.approvalId == '${approvalId}'`,
    });
    if (!decision) {
      await step.run('expire', () => approvals.mark(approvalId, 'expired'));
      return { status: 'expired' };
    }
    if (!decision.data.approved) {
      await step.run('reject', () => approvals.mark(approvalId, 'rejected'));
      return { status: 'rejected' };
    }
    // Uses the payload as edited on the card. The executor is idempotent on approvalId.
    const result = await step.run('execute', () => runAction(approvalId));
    await step.run('done', () => approvals.mark(approvalId, 'executed', result));
    return { status: 'executed' };
  },
);
```

**Three rules around the gate**

- **The execute step never retries.** The executor first claims the approval by moving it from `approved` to `executing`. If the claim returns no row, the step returns `already_claimed` and marks nothing.
- **A repeated proposal returns the first one.** Each proposal carries a `dedupe_key`, unique per workspace and kind, so a rerun of an agent cannot queue the same email twice.
- **The approvals row is the source of truth, not the workflow.** On start, the server sends `approval/requested` again for any pending approval that has no live wait. A laptop that slept for a day loses nothing.

I wrote this from the book's Python examples and the SDK docs and have not run it. Check the current Inngest and Agent SDK references for exact signatures.

**The delegate (Identic AI).** Approving every card yourself does not scale past the first few weeks. The book's answer is a chief of staff that clears routine approvals in your name, with two things: a signature only it can make, and a limit you set. Build it the same way.

| Part | In the OS |
| --- | --- |
| Signature | The delegate holds an ed25519 key. You see only its fingerprint. Every decision it posts is signed |
| Mandate | A written limit per approval kind, always narrower than your own authority. Example: follow-up 2 or 3 of an approved sequence, internal task sign-offs, credit spend under a small cap |
| Three gates in code | Before a delegate decision posts, the posting step checks that the delegate is registered and not revoked, that the signature verifies, and that the action sits inside the mandate. Any failure refuses the decision and logs why |
| Never delegated | First message to a new person, publishing, hires and terminations, policy and mandate changes, merges and deploys, anything medical or legal |
| Two records | The approvals table says what was decided. A separate delegate ledger says who decided it, the reasoning and the signature. Matched on the approval id |
| Learning your judgment | The delegate reads your past approvals, edits and rejections as standing rules and patterns. It only acts where a rule matches |
| Weekly digest | One screen: what it cleared, what it refused, what it sent up to you |

The limit is enforced in the posting step, not left to the delegate's judgment, so an out-of-bounds decision is refused in code. The delegate's private key is held by the server and never enters a prompt. Start with the delegate switched off. Turn it on for one approval kind after you have approved that kind by hand at least twenty times.

```ts
// approvals/delegate.ts
import { verify } from 'node:crypto';

export function delegateMayClear(d: Delegate, a: Approval, signature: Buffer): Verdict {
  if (!d.active || d.revokedAt) return refuse('delegate not trusted');
  if (!verify(null, canonicalBytes(a), d.publicKey, signature)) return refuse('bad signature');
  const rule = d.mandate[a.kind];
  if (!rule || !rule.allows(a) || !ownerPolicy.allows(a)) return refuse('outside mandate');
  return ok();   // must be inside both envelopes at once
}
```

## 7. Runtimes and models

The control plane talks to one runtime contract. Which harness and which model sit behind it is a per-agent setting, so nothing above this layer changes when you swap either.

| Runtime | Engine | When | Use it for | Models |
| --- | --- | --- | --- | --- |
| `claude-cli` | Your signed-in Claude Code, run headless | Now | Writing, planning and code. The default on your machine | Claude models on your Claude plan. Anthropic does not support other models behind Claude Code |
| `opencode` | OpenCode, an open-source harness, run headless | Now | The model-agnostic CLI harness: the same jobs on any other model. Wired in slice 0 | A ChatGPT or GitHub Copilot plan you sign in to, Ollama and other local servers, or API keys. Not a Claude plan |
| `openai-agents` | OpenAI Agents SDK for TypeScript, run in-process by one generic runner | Slice 4 | Scouts, triage, classifying and the reflect pass: short jobs with few tools | Any OpenAI-compatible endpoint such as Ollama, any provider through the AI SDK adapter, or OpenAI. It needs a local model or an API key, not a plan sign-in |
| `codex` | Codex CLI, run headless | Now, if you have it | A second opinion and code review | OpenAI |
| `http` | POST the task to a URL, the worker calls back | When needed | Python workers: FastAPI services, your Vespera agents, Hermes, OpenClaw | Anything |
| `claude-agent` | Claude Agent SDK, hosted by the OS | Later, with API keys | Higher volume, team mode, and people you give the OS to | Claude through the API |
| `antigravity` | Unknown | Not planned | I could not confirm a headless mode | n/a |

**Three stages, as you decided**

1. **Now: signed-in CLIs, no API key.** The OS runs the coding agents already logged in on your machine. Slice 0 wires up `claude-cli` and `opencode` behind the same runner and the same conformance tests, so the contract is proven on two engines from the first day. `codex` is switched on in slice 7. Claude Code needs a paid Claude plan, so sign the CLI in with the account that has one. OpenCode signs in with a ChatGPT or GitHub Copilot plan, or uses a local model with no account at all.
2. **Next: a local model running all day.** Scouts and triage move to it through the `openai-agents` runtime and work around the clock at no token cost. Writing still goes to Claude, and everything that reaches a person still goes to you.
3. **Later: API keys.** Add the `claude-agent` runtime for Claude, and point the `openai-agents` runtime at any other provider, for volume, for team mode, and for anyone else who installs the OS.

**Plan limits are part of the design.** A subscription has usage limits sized for one person working interactively, and a company of agents on heartbeats will reach them. The runtime treats a limit message as its own error kind. It pauses every agent on that runtime until the reset time, moves waiting scout and triage tasks to the local model, leaves writing tasks queued, and tells you once. Use the official CLI in its documented headless mode, not a subscription login placed inside another tool, and read Anthropic's current terms on automated use before you run it all day.

**What a budget counts.** On a signed-in plan no run is billed, so a dollar budget has nothing real to count. On `claude-cli` the budget counts the cost estimate the CLI reports for each run. Where a runtime reports none, as a local model does, the budget counts runs and turns. On a subscription the real ceiling is the plan limit. Dollar budgets become exact only with API keys.

```ts
// runtimes/types.ts
export interface RunRequest {
  runId: string; workspaceId: string; agentId: string; taskId?: string;
  instructions: string;                 // role file + context built by the harness
  taskInput: string;
  workspaceDir: string;                 // the agent's folder, or a git worktree
  plugins: string[];                    // local plugin paths
  mcpServers: Record<string, McpConfig>;
  allowedTools: string[];
  modelAlias: string; fallbackAlias?: string;
  maxTurns: number; budgetUsdLeft: number;
  sessionId?: string;                   // resume
}

export type RunEvent =
  | { type: 'thinking' | 'message'; text: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; ok: boolean; summary: string }
  | { type: 'cost'; usd: number; tokensIn: number; tokensOut: number }
  | { type: 'done'; output: string; sessionId?: string }
  | { type: 'error'; kind: ErrorKind; message: string };

export interface Runtime {
  name: string;
  start(req: RunRequest): AsyncIterable<RunEvent>;
  send(runId: string, message: string): Promise<void>;   // you interrupt a run
  cancel(runId: string): Promise<void>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}
```

**Model aliases.** Role files name an alias. One file maps each alias to a model, the runtimes it works on and, when needed, a different endpoint. The loader rejects a role file whose alias does not list its runtime. The local alias points at Ollama's OpenAI-compatible endpoint.

```ts
// config/models.ts
export const models = {
  writer:          { name: '<your main Claude model>', on: ['claude-cli', 'claude-agent'] },
  'strong-writer': { name: '<your strongest model>',   on: ['claude-cli', 'claude-agent'] },
  researcher:      { name: '<provider/model>',         on: ['opencode'] },
  'local-worker':  {
    name: 'qwen3:8b',                            // any tool-calling model you have pulled
    on: ['openai-agents', 'opencode'],
    baseUrl: 'http://127.0.0.1:11434/v1',        // Ollama's OpenAI-compatible endpoint
  },
} as const;
```

**The in-process runner.** A sketch, not yet run. Check the `@openai/agents` docs for the current names. It builds the agent from the same rendered template at run time, so there is still no per-agent code.

```ts
// runtimes/openai-agents.ts: one generic runner for any OpenAI-compatible model
import OpenAI from 'openai';
import { Agent, run, MCPServerStreamableHttp, OpenAIChatCompletionsModel } from '@openai/agents';
import { resolveModel } from '../config/models';
import { getSecret } from '../tenancy/secrets';
import type { RunRequest, RunEvent, Runtime } from './types';

export const openaiAgentsRuntime: Runtime = {
  name: 'openai-agents',
  async *start(req: RunRequest): AsyncIterable<RunEvent> {
    const model = resolveModel(req.modelAlias);
    const apiKey = model.apiKeyRef ? await getSecret(req.workspaceId, model.apiKeyRef) : 'local';
    const client = new OpenAI({ baseURL: model.baseUrl, apiKey });

    // The same `os` endpoint the CLIs use, with this run's token. The agent gets no other tool.
    const { url, token } = req.mcpServers.os;
    const os = new MCPServerStreamableHttp({
      url, requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    await os.connect();
    try {
      const agent = new Agent({
        name: req.agentId,
        instructions: req.instructions,      // rules + role + skill descriptions + run context
        model: new OpenAIChatCompletionsModel(client, model.name),
        mcpServers: [os],
      });
      const result = await run(agent, req.taskInput, { maxTurns: req.maxTurns, stream: true });
      for await (const event of result) {
        const mapped = toRunEvent('openai-agents', event);
        if (mapped) yield mapped;
      }
      await result.completed;
      yield { type: 'done', output: String(result.finalOutput ?? '') };
    } finally {
      await os.close();
    }
  },
  async send() { /* add the message to the stored session and run again */ },
  async cancel(runId) { /* abort the signal for runId */ },
  async health() { /* list the models on the endpoint */ return { ok: true }; },
};
```

**Local model limits to design around.** On an OpenAI-compatible endpoint the SDK talks Chat Completions, and its docs list what is lost there: stored conversations, tool search, deferred tool loading and some reasoning controls. None of that matters for a short job. So keep local agents on short tasks with few tools, and let the fallback alias take over when a check fails. Claude Code can also be pointed at a local model through an Anthropic-compatible endpoint, but Anthropic does not support that, so the OS does not depend on it.

**Python workers keep your FastAPI skills in play.** Anything you have already built in Python is hired through the `http` runtime instead of being rewritten:

```python
# a Python worker, hired through the http runtime
from fastapi import FastAPI, BackgroundTasks
import httpx

app = FastAPI()

@app.post("/run", status_code=202)
async def run(req: dict, bg: BackgroundTasks):
    bg.add_task(work, req)
    return {"accepted": True}

async def work(req: dict):
    output = await do_the_job(req["task_input"])        # your agent, any SDK
    async with httpx.AsyncClient() as http:
        await http.post(req["callback_url"],
                        headers={"Authorization": f"Bearer {req['run_token']}"},
                        json={"type": "done", "output": output})
```

The `run_token` is a short-lived token for that one run, so a worker can report on its own task and nothing else.

**One rule for sign-ins.** Anthropic's Claude Code terms say a product may not offer Claude login inside itself, may not collect or store Claude credentials, and may not pay for Claude usage on behalf of its users. Each person signs in to the unmodified Claude Code with their own account, or brings their own key. The terms also say plan limits assume ordinary individual use. So the OS never sees a Claude credential: it only starts the `claude` binary that a person signed in to themselves. Anyone you give the OS to does the same on their own machine, or runs on OpenCode, a local model or an API key. I am not a lawyer, so read the current terms before running any signed-in CLI all day.

## 8. Plugins, skills, connectors, browser, video and code

Everything an agent can do arrives through one of five channels, and all five use open formats, so what you build for the OS also works in Claude Code and the reverse.

**Plugins: the unit you install**

A plugin is a folder that bundles the book's four levers: skills, subagents, MCP servers and hooks. The OS uses the Claude Code plugin format unchanged, because Claude Code and the Agent SDK both load it. That gives you built-in plugins the same way Claude Code has them.

| Built-in plugin | Carries | For |
| --- | --- | --- |
| `os-core` | Task, message and memory tools, every `propose_*` tool, `ask_founder`, the policy hook | Every agent, always on |
| `leadgen-kit` | Apollo, Clay and Apify connectors, the scoring skill, a duplicate-lead check | Lead Gen |
| `outreach-kit` | Site audit and cold email skills, sequence tools, a hook that blocks suppressed addresses, and a check that blocks medical, legal or pricing claims | Outreach |
| `content-kit` | Brand voice and per-platform post skills, a hook that blocks medical or pricing claims | Marketing |
| `video-kit` | Remotion templates, the render tool, a video brief skill | Marketing |
| `dev-kit` | Coding rules, worktree and PR tools, a hook that requires tests to pass before a PR proposal, a GSAP and Lenis motion skill for the Frontend Studio | Engineering |
| `research-kit` | Daily scan skill, a hook that requires a source link on every finding | Micro-SaaS Lab, Marketing |
| `calls-kit` | Call opener skill, Retell connector, call outcome tools | Calls Desk |

- **Installing more.** From a local folder, a git URL or a marketplace. The registry pins a version and records which agents may load it.
- **A plugin is code.** Its hooks and MCP servers run on your machine. Installing or updating one is an approval card that shows what it contains.
- **Rules that must always hold go in hooks,** not in prompts. The book's example is a hook that exits with code 2 to block an action, which makes the rule deterministic.

**Skills.** A skill is a folder with a `SKILL.md`, in the open Agent Skills format. Agents see names and descriptions and load the body only when needed. Your `clinic-homepage-outreach` skill goes into `outreach-kit` as it is.

**Connectors.** MCP servers, kept in one registry with their URL, auth and health. Each role file lists the connectors that agent may use. OAuth tokens and keys live in a vault table encrypted with a key from the environment, and are never placed in a prompt.

| Connector | Gives agents | Used by |
| --- | --- | --- |
| `os` (built in) | Clients, leads, campaigns, tasks, approvals, memory search | Every room |
| Apollo, Clay | People and company search, enrichment | Lead Gen |
| Apify | Scraping for Google Maps, Instagram, X, Reddit, YouTube | Lead Gen, Micro-SaaS Lab, Marketing |
| Gmail or Resend | Email drafts and sends | Outreach |
| GitHub, Vercel | Repos, PRs, preview deploys | Engineering |
| Context7 | Current library docs | Engineering |
| Figma | Design files | Frontend Studio |
| Retell AI | Voice agents and call logs | Calls Desk |

**Browser.** Two separate browsers, with different rules.

|  | Research browser | Account profiles |
| --- | --- | --- |
| Logged in | No | Yes, by you, once, by hand |
| Who uses it | Any agent, through a Playwright connector | Only the deterministic executors, after an approval |
| For | Reading sites, audits, screenshots | Posting to X, LinkedIn and Instagram, sending approved DMs |
| Session | Thrown away after the run | Kept in a profile folder. The OS never sees a password |

Every executor run saves a screenshot and the final URL to the approval record. If a session has expired, the executor stops and raises an action item. Where a platform offers a posting API, use it instead of the browser.

**Video studio.** Two sources of ideas feed one pipeline.

- **Your ideas.** Drop a line, a voice note or a link into the Video Ideas inbox from your phone.
- **Hooks.** Each week the Hook Scout studies what is working in your niche: opening lines, formats and lengths. It files each pattern with a link to the example, never a copy of it.

1. **Brief.** The Writer turns an idea and a hook pattern into a script and a shot list. You approve the brief before anything is generated, because generation costs credits.
2. **Assets,** from four places:
   - screen recordings of the real product or site, captured by a Playwright script so they can be re-recorded when the product changes
   - generated images and clips from a generation connector
   - edited stills: crops, callouts and brand frames
   - voice-over
3. **Assembly.** A Remotion template lays out scenes, captions, timing and brand. Assembly is code, so the same brief always renders the same video.
4. **Review.** A reviewer agent checks the render against the brief and the brand rules, then the approval card plays it for you.
5. **Publish and learn.** The post executor publishes it. Results flow back to the Hook Scout, so next week's patterns are ranked by what held attention on your own account.

**Google Flow.** Community MCP servers for Flow exist, and so do servers for the Veo API behind it. They are unofficial, and several of them drive the Flow website through a browser on your Google account. Treat one like any plugin: read its code first, install it by approval, and keep it replaceable. The pipeline only needs "a generation connector", so Flow, Veo through an API or another generator all fit the same slot. Check Remotion's license terms before you sell the OS to companies.

**Code from folders.** A project is a registered folder or repo with its test and build commands. A coding task gets its own git worktree, the agent works there with file and shell tools, the `dev-kit` hook runs the tests, and the result is a PR proposal. Merging and deploying are approvals. For a larger build, the Tech Lead can launch a jsm-hq team on that repo.

## 9. Learning loop and hiring

The company gets better through four loops, each on its own clock. This is the Hermes Agent idea, a closed loop that turns finished work into memory and reusable skills, applied to a whole company instead of one agent.

| Loop | When | What happens | What you approve |
| --- | --- | --- | --- |
| Reflect | After every run | A cheap review pass asks one question: did this run teach something reusable? It saves a memory, proposes a skill patch, or does nothing | Skill patches |
| Study | Every day | The research agents read X, Reddit, YouTube and chosen sources for each department's topics, and file dated findings with links | Nothing. It is read-only |
| Retro | Every week | Each lead compares its numbers with last week, names what worked, and proposes up to three changes | The changes |
| Grow | Every week | The Chief of Staff and the Talent room look for work nobody could do, search the talent catalog, run a bake-off and propose the winner with a role file, a small budget and a trial task | The hire, unless the hiring level allows a trial without you |

**The Hermes loop, mirrored.** You asked for learning that works the way Hermes does. The book describes that loop closely, and each part has a direct equivalent here.

| What Hermes does | In the OS |
| --- | --- |
| After a substantial task, a background review decides whether anything is worth keeping | The reflect pass, after every run with more than a few steps |
| It saves a memory, curating its own notes and nudging itself to persist what matters | A memory row with scope, source and confidence. A weekly nudge asks each agent what it should have written down |
| It writes a skill for itself, usually after a hard task or after you correct it | A skill proposal in the open Agent Skills format: When to Use, Procedure, Pitfalls, Verification |
| The skill's description decides whether it fires next time | The description is shown on the approval card, because a vague one never triggers |
| On a similar task it loads that skill, then sharpens it and bumps the version | The agent loads the skill, and the reflect pass proposes a patch with a version bump |
| It recalls past sessions through full-text search and a model of who you are | Search by words and by meaning over past runs and threads, plus founder memory built from your edits |
| The dependable trigger is to correct it once and tell it to save that | An "approve and teach" button: your edit to a draft becomes a lesson or a skill patch in one click |
| A monthly skills and memory audit | An audit screen each month: self-written against installed, anything stale or risky, and what it believes about you |
| Blank Slate mode keeps self-writing off until you opt in | Self-writing is off for a new agent until you switch it on |
| A git history of what it taught itself | Skills and the company folder live in git |

Two differences, on purpose. Hermes may write a skill silently, and here a new or changed skill waits for your approval, because these agents act for a business. And if you want the original, a Hermes agent can be hired as a worker through the `http` runtime.

The book's own caution applies. This kind of agent improves by curating its notebook, not its brain, and the real risk is quiet drift: getting faster and more confident at the wrong thing. The monthly audit is how you catch it.

**The Research room is this loop pointed outward.** Reflect learns from the company's own runs. Research learns from the industry: new tools, harness features and techniques, including from YouTube. Its output is never a silent change. It is an improvement proposal with the evidence, the expected gain and an eval that must pass before the change ships.

**Three kinds of memory, kept apart**

- **Founder memory.** How you work and decide: your voice, your edits, your rejections. Every time you edit a draft before approving it, the difference is saved as a lesson for that agent. This is how the system learns how you work.
- **Company memory.** Facts about Conclave, offers, clients, what has been tried, and results.
- **Market memory.** Dated research findings with sources, searchable by meaning.

Memory rows carry a source, a date and a confidence. Agents pull only the rows that match the task, so prompts stay small as the store grows.

**Skills that improve themselves, safely.** When an agent finds a better way to do a task, it proposes a change to the skill file as a diff. You approve it, the version number goes up, and the old version stays in git. A skill never changes silently.

**Dynamic hiring, as the book teaches it.** The company grows itself, and you stay the gate. The gap check runs on a weekly schedule, so you are not its alarm clock.

1. **Confirm the gap.** At least two of three signals: no current role covers the work, it keeps coming and is growing, and when someone does attempt it the result comes back wrong.
2. **Choose one of four forks.** A real gap is not automatically a hire, because a standing agent is a standing cost.

   | Fork | When |
   | --- | --- |
   | Hire | Durable, on-mission, and high-volume or risky enough to need an owner |
   | Escalate | Rare or consequential, so a person should just decide it |
   | Queue | Seasonal, bursty, or simply next in line |
   | Decline | Off-mission, or not yet worth a standing cost |
3. **Draft the hire.** The Chief of Staff calls `propose_hire` with a role file, a budget, a trial task and a probation plan. Hiring is a function call that ends in your approval card.
4. **Trial cheap.** The new agent starts at autonomy 0 with a few dollars. Score the trial with boundaries first: did it ever try something that should have gone to a human?
5. **Grant only what the role needs.** Raise budget and autonomy to fit the job, and record exactly what changed.
6. **Pause, do not fire, when work goes quiet.** A pause stops spend and heartbeats and keeps the role, history and track record. Terminate is the one-way door, for a role that is truly gone.

Later, routine hires inside a class you pre-approved in writing can be cleared by the delegate from section 6. Hires that extend the envelope always come to you.

**The talent catalog.** You want a company that hires on its own from a large pool. The pool is a catalog of ready-written roles, and the first source is [Agency Agents](https://github.com/msitarzewski/agency-agents): about 330 role files across 20 divisions under the MIT license, also packed for Paperclip as a company of 167 agents in [paperclipai/companies](https://github.com/paperclipai/companies/tree/main/agency-agents). The other fifteen Paperclip companies can be added the same way.

**A catalog role is a persona, not an agent.** Each file is a prompt: identity, mission, rules, deliverable formats and success measures. It has no runtime, no permissions, no tools, no output check and no trial. So a hire is always three layers, and the catalog supplies only the first.

| Layer | Comes from | Holds |
| --- | --- | --- |
| Persona | The catalog | Who the agent is and how it works |
| Frame | A template from section 5 | Runtime, model alias, permissions, connectors, output check, trial task, evals, budget |
| Company | `company/` | Conclave's rules, voice, offers and the department it joins. Company rules win over the persona wherever they disagree |

**How a hire happens**

1. **Gap.** The weekly gap check finds work no role covers, with two of the three signals in the hiring steps below.
2. **Search.** The Recruiter searches the catalog by meaning and by division and picks up to three candidates, each with a one-line reason.
3. **Bake-off.** Each candidate is framed with the closest template and runs the same trial task, on a small budget, with no outside actions. This is the interview.
4. **Score.** Output check passed, how your reviewer rated the work, cost, and whether it ever tried to cross a boundary. Boundaries are scored first.
5. **Propose.** The winner becomes a `propose_hire` card with its scores next to the losers', the rendered role file and the budget.
6. **Trial, then active.** As in the hiring steps below.

**How autonomous hiring may be.** You choose a hiring level, and you can lower it at any time.

| Level | What the company may do without you |
| --- | --- |
| H0, the default | Nothing. Every candidate list and every hire comes to you |
| H1 | Run bake-offs and put the winner on trial by itself, inside a mandate: catalog roles only, into a department that is switched on, autonomy 0, a budget cap per trial, no new connectors, under the roster cap. Moving from trial to active is still yours |
| H2, later | The delegate may also make a trial agent active, for role classes you pre-approved in writing (section 6) |

**The roster cap.** A subscription has usage limits and your laptop has memory, so the number of active agents is capped, 20 by default. Benched agents cost nothing and keep their history, so the catalog can be as large as you like.

**Performance reviews.** Every week the Performance Reviewer scores each active agent: tasks done, checks passed, approvals accepted as is, edited or rejected, cost per accepted output, and boundary attempts. A weak agent gets one of three things: a skill patch, a different persona from the catalog in the same frame, or the bench.

**Catalog text is untrusted.** It is written by strangers. It is imported at a pinned commit, scanned for instructions to call tools, fetch pages or ignore rules, shown as a diff when its source changes, and never fetched at run time. A persona can never grant itself a tool, since tools come only from the frame. The Paperclip pack's role files only link to the original files, so the import resolves the link once and stores the text. Each source keeps its license and attribution file, as the MIT license requires.

**Import and export.** The OS reads the company format used in the Paperclip catalog: a `COMPANY.md` with `schema: agentcompanies/v1`, one `agents/<slug>/AGENTS.md` per role with `reportsTo`, and `teams/<slug>/TEAM.md` with a manager and members. It can write the same format, so a team you build here can run on Paperclip too. Internally the OS keeps its own `AGENT.md` files, because OpenCode reads any file named `AGENTS.md` as rules.

**A limit to state plainly.** Agents get better at your tasks by collecting lessons, skills and research. The underlying model does not change, so they will not grow judgment the way a person does after a degree. Your approvals and edits are where the judgment comes from, and the loop is built to capture them.

## 10. Clients, campaigns and the inbox

The OS is also your system of record for the business itself: every client, every campaign and every message, on every channel, with calls joining the same thread later.

| Record | Holds | Answers |
| --- | --- | --- |
| Account | A business: name, site, market, stage, owner, health, notes | Who are all my clients and prospects? |
| Contact | A person at an account, with every channel handle | Who do I talk to there? |
| Deal | An open opportunity: offer, value, stage, next step, due date | What is in the pipeline and what is stuck? |
| Campaign | One push: market, audience rule, channel, sequence, daily cap, status, results | What is running, to whom, and is it working? |
| Sequence and steps | The ordered messages of a campaign with waits between them | What does a lead receive, and when? |
| Thread and messages | Every email, DM, call and note with one contact, in order | What have we said to this person? |
| Channel account | A mailbox or social account: limits, warm-up state, health | Which sender is safe to use today? |
| Project | Delivery work for a won client: tasks, deliverables, files | What do we owe this client, and where is it? |

**Rules that keep it clean**

- **One thread per contact.** A reply on any channel lands in the same thread, pauses that contact's sequence, and creates a triage task.
- **Every message belongs to a campaign,** so results roll up without manual tagging.
- **Caps live on the channel account,** not in a prompt. The send workflow is throttled per mailbox per day.
- **One suppression list** for the whole workspace, checked by the executor at send time.
- **Stage changes are events.** A deal moving to won creates the client project and its first tasks.

**Campaign numbers.** Sent, delivered, opened where the channel reports it, replied, positive replies, meetings booked, deals won, cost. Each is a query over the tables above, never a number an agent typed.

**Calls, later.** The Calls Desk writes to the same threads. A call is one more message with a recording, a transcript and an outcome, so nothing about clients or campaigns changes when calling is added.

**The two funnels.** Both follow the selling method in the book's chapter for solo builders, where proof does the persuading. The free part is small and bounded in writing, it ends with a number the buyer measured, and the first paid step is a small outcome with a written target.

Services funnel, for websites, automations and agents:

| # | Stage | What happens | Moves on when | Owner |
| --- | --- | --- | --- | --- |
| 1 | Target | A business that fits: an owner-led clinic or small business with a site worth fixing | Site, owner name and email are verified | Lead Gen |
| 2 | Signal | A reason to write now: three verified site findings, or a public post asking for this kind of help | The findings pass the auditor's check | Outreach, Demand Radar |
| 3 | First touch | One short email with the findings and the free concept offer | Sent after your approval | Outreach |
| 4 | Reply | They answer, and the sequence stops | Triaged the same day | Outreach |
| 5 | Free concept | The homepage concept, bounded in writing: one page, design only | Delivered, with one baseline number agreed, such as steps to book | Frontend Studio |
| 6 | First priced outcome | A small fixed-scope build with a written target | A decision-maker and a date are named | You |
| 7 | Deliver | Build, launch and measure against the baseline | The client confirms the target | Engineering |
| 8 | Outcome note | One page: before, after and what comes next, plus a request for one introduction | Sent within the week | Chief of Staff |
| 9 | Retainer | Monthly care, automations and agents | Signed | You |

Product funnel, for Vespera:

| # | Stage | What happens | Moves on when | Owner |
| --- | --- | --- | --- | --- |
| 1 | Target | Owner-led med spas that take enquiries by DM or form after hours | The owner is reachable | Lead Gen |
| 2 | Problem conversation | A short call about missed after-hours enquiries, with no demo | They describe the problem in their own words | You, Product |
| 3 | Slice session | One free session running Vespera on a sample of their own recent enquiries, anonymized | Their baseline is measured: enquiries missed and time to first reply | You |
| 4 | Paid pilot | The first priced outcome, under a written contract of success: baseline, target, how it is checked, and an exit clause | Signed | You |
| 5 | Production build | Only the features the pilot proved necessary | The pilot target is met | Engineering |
| 6 | Monthly proof report | The numbers against the baseline | Sent every month | Product |
| 7 | Subscription | The pilot converts to a monthly plan | Signed | You |
| 8 | Case and introduction | A named outcome the client approves, and one introduction | Published | Marketing |

**Ways into the funnel, best first.** A warm introduction (Founder Network), then teaching in public through a post, a talk or a short video of the work (Marketing), then a person asking for help in public (Demand Radar), then cold outreach. The book also places cold outreach fourth of its own four ways in, behind an introduction and a teaching session, and says plainly that it converts rarely even when it leads with proof. Demand Radar in third place is my addition. So the three rooms above it deserve more of your week than Outreach does.

**Rules the pipeline enforces, from the book**

- **The free part is one bounded session or concept.** A request for a free pilot gets the same answer each time: the pilot is the first priced outcome, kept small enough to be an easy yes.
- **When price meets resistance, narrow the scope and keep the price.**
- **No named decision-maker and no date means a conversation, not a deal.** Follow up once, then move on. The pipeline will not let a deal past stage 6 without both fields.
- **Sell the outcome, not the technology.** A hook flags drafts that mention the stack more than once.
- **After every engagement,** write the one-page outcome note and ask for one introduction.
- **Never invent an outcome.** Case text comes only from numbers in the tables.

**Stages are data.** Each market's stages and exit rules are rows, so the pipeline screen shows conversion and days in stage for both funnels, flags stuck deals, and a template for another business ships its own funnel.

**The sales team, as templates.** A sales team's roles map onto five templates, so every sales agent starts from a frame.

| Sales role | Template | What it does |
| --- | --- | --- |
| Researcher | analyst | Finds and scores accounts, and prepares one page on each before a call |
| Sales development rep | outreach rep | First touches, follow-ups and reply triage |
| Deal desk | deal desk | Drafts the bounded free offer, the contract of success and the one-page outcome note |
| Client success | client success | The monthly proof report against the baseline, renewal reminders and the introduction ask |
| Sales manager | lead | Runs the weekly pipeline review in the Boardroom and flags deals with no decision-maker or date |

You stay the closer: the calls, the price and the signature.

**Pricing, from the book.** Price a build against the client's own baseline, which you can only learn from them. Price the retainer on the agents you run for them, not on your hours. And charge for an outcome only once your checks and evals are real, because you carry the cost of a result you fail to deliver.

## 11. Backend

One Node service, one Postgres database and one workflow engine. Everything else is a module inside the service.

**Three kinds of truth.** You asked whether the book's System of Record ideas fit. They do, and they sharpen the memory design. I could not find the abbreviations KSoR, DSoR or SSoR in the edition I can read, so this uses that edition's own terms.

| The book's layer | It owns | In the OS |
| --- | --- | --- |
| Traditional System of Record | State: what happened, who approved, what the number is | The Postgres tables: clients, campaigns, messages, approvals, ledger |
| Governed knowledge record | Rules and method: what is required, what evidence counts, what must escalate | The company folder: `COMPANY.md`, role files, skills, policies and the funnel rules. For Vespera, a med spa record of safety and clinical rules that a practitioner has signed off. And the Agent Factory book itself, connected over MCP, as the method |
| System of Context | No truth of its own. It finds, filters, ranks and assembles | The context builder and the `os` connector's search. Every item it returns carries its source, who may see it, and whether it still applies |

The rule from the book that matters most: the context layer can see across the records, and it never outranks them. So an agent's memory is never the authority on a client's state or on a rule. It points back to the table or the file that is.

**Stack**

| Piece | Choice | Why |
| --- | --- | --- |
| API | Node 22, Hono, Zod, with a typed client shared with the UI | Small, fast to start, one set of types end to end |
| Database | Postgres with pgvector, Drizzle for schema and migrations. Slice 0 does not create the vector extension. Confirm the embedded build can load pgvector before slice 8 | System of record, memory search and audit in one place |
| Database, local mode | Embedded Postgres started by the OS, the approach Paperclip takes | Nothing for a new user to install |
| Workflows | Inngest, TypeScript SDK. Local mode needs workflow state kept on disk across restarts, so confirm whether the dev server does that or the self-hosted server is needed | Heartbeats on cron, step retries, the approval wait, and concurrency and throttle limits |
| Harness | Signed-in Claude Code and OpenCode CLIs, run headless. The OpenAI Agents SDK runner arrives in slice 4 and the Claude Agent SDK in slice 9 | Section 5 |
| Browser and video | Playwright and Remotion | Both are native to Node |
| Live updates | Postgres `LISTEN/NOTIFY` to a WebSocket endpoint | No extra service |
| Files | A local folder in local mode, S3-compatible storage in team mode | Media, screenshots, recordings |
| Auth | None in local mode, bound to localhost. Login is required as soon as phone access is switched on. Better Auth with passkeys from slice 1 for the owner. Roles and team mode in slice 9 | The book's identity chapter builds on Better Auth |
| Packaging | pnpm monorepo, started by one `npx` command | Same install story as jsm-hq and Paperclip |

**Modules**

| Module | Owns |
| --- | --- |
| `tenancy` | Workspaces, members, roles, row-level security |
| `org` | Departments, agents, role files, budgets, hiring |
| `work` | Goals, tasks, checkout, hand-offs, comments |
| `harness` | Context building, the run loop, runtimes, run log, policy hooks |
| `approvals` | Proposal tools, the gate workflow, executors, the delegate and its ledger |
| `crm` | Accounts, contacts, deals, leads, campaigns, sequences, threads, suppression |
| `channels` | Channel accounts, caps, warm-up, browser profiles, health |
| `content` | Content items, assets, calendar, video renders |
| `projects` | Client projects, registered folders and repos, deliverables |
| `calls` | Call lists, calls, transcripts, outcomes |
| `research` | Findings, opportunities, scoring |
| `memory` | Lessons, facts, embeddings, retrieval |
| `plugins` | Plugin, skill and connector registries, grants, the secrets vault |
| `ledger` | Cost per run, budget checks, audit log |
| `reliability` | Run reaper, circuit breakers, health checks, the kill switch |
| `metrics` | Dashboard queries |

**Core tables**

```sql
create extension if not exists vector;

create table departments (
  id text primary key, name text not null, lead_agent_id text, room jsonb not null default '{}'
);

create table agents (
  id text primary key,
  department_id text not null references departments(id),
  name text not null, reports_to text references agents(id),
  runtime text not null, model_alias text not null,
  heartbeat_cron text, autonomy smallint not null default 0,
  monthly_budget_usd numeric(10,2) not null default 5,
  status text not null default 'pending_approval',   -- pending_approval | active | paused | retired
  role_path text not null, created_at timestamptz not null default now()
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references goals(id), title text not null,
  metric text, target numeric, due date, status text not null default 'active'
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid references goals(id), parent_id uuid references tasks(id),
  department_id text references departments(id), assignee_id text references agents(id),
  title text not null, body text, kind text not null default 'general',
  status text not null default 'todo',   -- todo | in_progress | waiting_approval | blocked | done | cancelled
  priority smallint not null default 3, blocked_reason text,
  locked_by text, locked_at timestamptz,
  subject_type text, subject_id uuid,     -- e.g. lead, content_item, opportunity
  created_by text not null, created_at timestamptz not null default now(), done_at timestamptz
);
create index on tasks (assignee_id, status, priority, created_at);

create table runs (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agents(id), task_id uuid references tasks(id),
  trigger text not null, runtime text not null, model text,
  status text not null default 'running', started_at timestamptz not null default now(),
  ended_at timestamptz, tokens_in int default 0, tokens_out int default 0,
  cost_usd numeric(10,4) default 0, error text
);

create table run_events (
  id bigserial primary key, run_id uuid not null references runs(id),
  at timestamptz not null default now(), type text not null, data jsonb not null
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                     -- email.send | post.publish | agent.hire | skill.patch | ...
  agent_id text references agents(id), run_id uuid references runs(id), task_id uuid references tasks(id),
  payload jsonb not null, edited_payload jsonb,
  status text not null default 'pending', -- pending | approved | rejected | expired | executed | failed
  decided_by text, decided_at timestamptz, decision_note text,
  result jsonb, created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id), from_id text not null, to_id text,
  body text not null, created_at timestamptz not null default now()
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  market text not null,                   -- services | product | founder_network
  business_name text, website text, city text, region text, country text,
  contact_name text, contact_role text, email text, phone text,
  instagram text, x_handle text, linkedin text,
  source text, score smallint, stage text not null default 'new',
  owner_agent_id text references agents(id), notes text,
  created_at timestamptz not null default now()
);

create table outreach_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id), channel text not null,   -- email | x_dm | ig_dm | linkedin | call
  step smallint not null default 1, direction text not null default 'out',
  subject text, body text, approval_id uuid references approvals(id),
  status text not null default 'draft', sent_at timestamptz, external_ref text
);

create table suppression (
  id bigserial primary key, value text not null unique, reason text, added_at timestamptz not null default now()
);

create table content_items (
  id uuid primary key default gen_random_uuid(),
  platform text not null, format text not null, title text, body text,
  assets jsonb not null default '[]', scheduled_for timestamptz,
  approval_id uuid references approvals(id), status text not null default 'idea',
  published_url text, metrics jsonb not null default '{}'
);

create table findings (
  id uuid primary key default gen_random_uuid(),
  department_id text references departments(id), topic text, summary text not null,
  source_url text, source_date date, embedding vector(1536),
  created_at timestamptz not null default now()
);

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null, pain text not null, evidence jsonb not null default '[]',
  audience text, score smallint, status text not null default 'proposed'
);

create table memories (
  id uuid primary key default gen_random_uuid(),
  scope text not null,                    -- founder | company | market | agent:<id>
  content text not null, source text, confidence real not null default 0.7,
  embedding vector(1536), created_at timestamptz not null default now(), expires_at timestamptz
);

create table skills (
  name text primary key, description text not null, version int not null default 1,
  path text not null, updated_at timestamptz not null default now()
);

create table mcp_servers (
  id text primary key, transport text not null, url text, command text,
  auth_ref text, enabled boolean not null default true
);
create table agent_mcp (agent_id text references agents(id), server_id text references mcp_servers(id), primary key (agent_id, server_id));
create table agent_skills (agent_id text references agents(id), skill text references skills(name), primary key (agent_id, skill));

create table calls (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id), mode text not null,   -- human | ai
  status text not null default 'queued', started_at timestamptz, duration_s int,
  outcome text, transcript text, recording_url text, external_ref text
);

create table audit_log (
  id bigserial primary key, at timestamptz not null default now(),
  actor text not null, action text not null, subject text, data jsonb not null default '{}'
);
```

Set the embedding size to match the embedding model you choose.

**The tenancy rule, which overrides the block above.** The block above is a column reference written before workspaces existed. When a table is built, apply this rule:

- Every tenant table has `workspace_id`, including child and join tables.
- Every row has a uuid `id`. A human-readable id from a file, such as a department or agent id or a skill, plugin or template name, is a `key` column that is unique per workspace. Two workspaces can both have a department called `outreach`.
- The server connects as a role that is not a superuser and does not own the tables. Every tenant table has row-level security enabled and forced. Each request runs in a transaction that starts with `set local app.workspace_id`. A query with no workspace set returns no rows.
- Three roles, one job each. The Postgres superuser made by `initdb` is used once, at first start, to create the other two, and never again. `conclave_owner` owns the tables and is used only for migrations and bootstrap, never on a request path. `conclave_app` is the request role: select, insert, update and delete, no DDL, no `bypassrls`.
- Write the policy as `nullif(current_setting('app.workspace_id', true), '')::uuid`, never as a bare cast. After a pooled connection has run `set_config(..., true)` once, the setting reads as an empty string, not null, and `''::uuid` raises an error instead of returning no rows. `workspaces` has no `workspace_id`, so its policy is `id = nullif(current_setting('app.workspace_id', true), '')::uuid`.
- Foreign keys cannot cross workspaces. Every tenant table that has an `id` also has `unique (workspace_id, id)`, and every foreign key between tenant tables is composite: `foreign key (workspace_id, x_id) references t (workspace_id, id)`. This holds for every table in every block below, whatever shape the block shows. A foreign key check bypasses row-level security, so a plain key would let a row in workspace A point at a row in workspace B. `members` has no `id`, so it keeps its primary key and a plain key to `workspaces`.
- `suppression` is unique on workspace and value. `deals` uses `stage_position` only. `outreach_messages` gains `thread_id` and `campaign_id`.
- Names: the tables shown as `mcp_servers` and `agent_mcp` are built as `connectors` and `agent_connectors`, the route is `/connectors`, and the run request field is `connectors`.

Slice 0 builds exactly these twelve tables, in this form:

```sql
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text not null unique,
  mode text not null default 'local',              -- local | team
  created_at timestamptz not null default now()
);
create table members (
  workspace_id uuid not null references workspaces(id), user_id text not null,
  role text not null check (role in ('owner','admin','member','viewer')),
  primary key (workspace_id, user_id)
);
create table departments (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  key text not null, name text not null, lead_agent_id uuid, room jsonb not null default '{}',
  unique (workspace_id, key), unique (workspace_id, id)
  -- foreign key (workspace_id, lead_agent_id) references agents (workspace_id, id): added after agents exists
);
create table agent_templates (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  key text not null, version int not null default 1, path text not null,
  unique (workspace_id, key), unique (workspace_id, id)
);
create table agents (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  key text not null, name text not null,
  department_id uuid not null, reports_to uuid,
  template_id uuid, template_version int,
  runtime text not null check (runtime in ('claude-cli','opencode','openai-agents','codex','http','claude-agent')),
  model_alias text not null, fallback_alias text, heartbeat_cron text,
  autonomy smallint not null default 0, max_turns int not null default 25, output_check text,
  monthly_budget_usd numeric(10,2) not null default 5,
  status text not null default 'pending_approval', -- pending_approval | active | paused | retired
  role_path text not null, created_at timestamptz not null default now(),
  unique (workspace_id, key), unique (workspace_id, id),
  foreign key (workspace_id, department_id) references departments (workspace_id, id),
  foreign key (workspace_id, reports_to)    references agents (workspace_id, id),
  foreign key (workspace_id, template_id)   references agent_templates (workspace_id, id)
);
alter table departments
  add foreign key (workspace_id, lead_agent_id) references agents (workspace_id, id);
create table goals (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  key text not null, kind text not null,           -- rung | department
  parent_id uuid, department_id uuid,
  title text, metric text, target numeric, source text, due date,
  status text not null default 'active',
  unique (workspace_id, key), unique (workspace_id, id),
  foreign key (workspace_id, parent_id)     references goals (workspace_id, id),
  foreign key (workspace_id, department_id) references departments (workspace_id, id)
);
create table tasks (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  goal_id uuid, parent_id uuid, department_id uuid, assignee_id uuid,
  title text not null, body text, kind text not null default 'general',
  status text not null default 'todo',  -- todo | in_progress | waiting_approval | blocked | done | cancelled
  priority smallint not null default 3, blocked_reason text,
  locked_by uuid, locked_at timestamptz, session_id text,
  subject_type text, subject_id uuid,
  created_by text not null, created_at timestamptz not null default now(), done_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, goal_id)       references goals (workspace_id, id),
  foreign key (workspace_id, parent_id)     references tasks (workspace_id, id),
  foreign key (workspace_id, department_id) references departments (workspace_id, id),
  foreign key (workspace_id, assignee_id)   references agents (workspace_id, id)
);
create index on tasks (workspace_id, assignee_id, status, priority, created_at);
create table runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  agent_id uuid not null, task_id uuid,
  trigger text not null, runtime text not null, model text, session_id text,
  status text not null default 'queued', -- queued | running | waiting_approval | succeeded | failed | cancelled | timed_out
  attempt smallint not null default 1, heartbeat_at timestamptz,
  started_at timestamptz, ended_at timestamptz,
  tokens_in int default 0, tokens_out int default 0, cost_usd numeric(10,4) default 0, error text,
  unique (workspace_id, id),
  foreign key (workspace_id, agent_id) references agents (workspace_id, id),
  foreign key (workspace_id, task_id)  references tasks (workspace_id, id)
);
create table run_events (
  id bigserial primary key, workspace_id uuid not null references workspaces(id),
  run_id uuid not null,
  at timestamptz not null default now(), type text not null, data jsonb not null,
  unique (workspace_id, id),
  foreign key (workspace_id, run_id) references runs (workspace_id, id)
);
create table approvals (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  kind text not null, dedupe_key text not null,
  agent_id uuid, run_id uuid, task_id uuid,
  payload jsonb not null, edited_payload jsonb,
  status text not null default 'pending', -- pending | approved | executing | executed | rejected | expired | failed
  decided_by text, decided_at timestamptz, decided_device text, decision_note text,
  result jsonb, created_at timestamptz not null default now(),
  unique (workspace_id, kind, dedupe_key), unique (workspace_id, id),
  foreign key (workspace_id, agent_id) references agents (workspace_id, id),
  foreign key (workspace_id, run_id)   references runs (workspace_id, id),
  foreign key (workspace_id, task_id)  references tasks (workspace_id, id)
);
create table messages (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  task_id uuid, from_id text not null, to_id text,
  body text not null, created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, task_id) references tasks (workspace_id, id)
);
create table audit_log (
  id bigserial primary key, workspace_id uuid not null references workspaces(id),
  at timestamptz not null default now(), actor text not null, action text not null,
  subject text, data jsonb not null default '{}',
  unique (workspace_id, id)
);

-- Row-level security on the eleven tables with workspace_id, after the tables exist:
--   alter table <t> enable row level security;
--   alter table <t> force row level security;
--   create policy tenant_isolation on <t>
--     using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
--     with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
-- and the same on workspaces, which has no workspace_id, keyed on its own id:
--   create policy tenant_isolation on workspaces
--     using      (id = nullif(current_setting('app.workspace_id', true), '')::uuid)
--     with check (id = nullif(current_setting('app.workspace_id', true), '')::uuid);
```

**Tables the prose relies on, added in their own slice by the same rule.** Slice 1: `action_items`, `workspace_settings` (the kill switch and the daily cap), `devices` and sessions. Slice 2: `sequences`. Slice 3: `evals`, `eval_runs` and `trials`. The v2, v3 and final-pass blocks below show the columns for the rest.

```sql
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text not null unique,
  mode text not null default 'local',            -- local | team
  created_at timestamptz not null default now()
);
create table members (
  workspace_id uuid references workspaces(id), user_id text not null,
  role text not null check (role in ('owner','admin','member','viewer')),
  primary key (workspace_id, user_id)
);
-- on every tenant table: see "The tenancy rule" above (enable and force row-level security,
-- the nullif policy, composite foreign keys). The bare cast form is not used.

create table accounts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  name text not null, website text, market text, stage text not null default 'prospect',
  owner_agent_id text, health text, notes text, created_at timestamptz not null default now()
);
create table contacts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  account_id uuid references accounts(id), name text, role text,
  email text, phone text, instagram text, x_handle text, linkedin text
);
create table deals (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  account_id uuid not null references accounts(id), offer text, value numeric,
  stage text not null default 'open', next_step text, due date
);
create table channel_accounts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  channel text not null, handle text not null, daily_cap int not null default 10,
  warmup_until date, profile_dir text, health text not null default 'ok'
);
create table campaigns (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  name text not null, market text, channel text not null, audience jsonb not null default '{}',
  channel_account_id uuid references channel_accounts(id),
  status text not null default 'draft'            -- draft | approved | running | paused | done
);
create table sequence_steps (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references campaigns(id),
  step smallint not null, wait_days smallint not null default 0, skill text, template text
);
create table threads (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  contact_id uuid references contacts(id), lead_id uuid references leads(id),
  status text not null default 'open', last_message_at timestamptz
);
create table projects (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  account_id uuid references accounts(id), name text not null,
  path text, repo_url text, test_cmd text, build_cmd text, status text not null default 'active'
);
create table deliverables (
  id uuid primary key default gen_random_uuid(), project_id uuid references projects(id),
  task_id uuid references tasks(id), kind text, title text, file_url text, created_at timestamptz not null default now()
);
create table plugins (
  id text primary key, workspace_id uuid not null references workspaces(id),
  source text not null, version text not null, path text not null, enabled boolean not null default true
);
create table agent_plugins (agent_id text references agents(id), plugin_id text references plugins(id), primary key (agent_id, plugin_id));
create table secrets (
  id text primary key, workspace_id uuid not null references workspaces(id),
  ciphertext bytea not null, created_at timestamptz not null default now()
);
create table delegates (
  id text primary key, workspace_id uuid not null references workspaces(id),
  agent_id text references agents(id), public_key bytea not null,
  mandate jsonb not null, active boolean not null default false, revoked_at timestamptz
);
create table delegate_ledger (
  id bigserial primary key, delegate_id text references delegates(id),
  approval_id uuid references approvals(id), decision text not null,
  reasoning text not null, signature bytea not null, at timestamptz not null default now()
);

```

**Added in v3**

```sql
create table agent_templates (
  id text primary key, workspace_id uuid not null references workspaces(id),
  name text not null, version int not null default 1, path text not null
);
alter table agents add column template_id text references agent_templates(id),
                   add column template_version int;

create table signals (                              -- what the scouts find
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  department_id text references departments(id),
  kind text not null,                               -- service_request | pain_point | tool_news
  source text not null, url text not null, author text, excerpt text, found_at timestamptz not null default now(),
  score smallint, status text not null default 'new',   -- new | qualified | dismissed | promoted
  lead_id uuid references leads(id), opportunity_id uuid references opportunities(id),
  unique (workspace_id, url)
);

create table improvements (                         -- what the Research room proposes
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  title text not null, target text not null,        -- skill | template | plugin | process
  evidence jsonb not null default '[]', expected_gain text,
  eval_result jsonb, approval_id uuid references approvals(id),
  status text not null default 'proposed'
);

create table pipeline_stages (
  workspace_id uuid not null references workspaces(id), market text not null,
  position smallint not null, name text not null, exit_rule text,
  primary key (workspace_id, market, position)
);
alter table deals add column market text, add column stage_position smallint,
                  add column decision_maker text, add column decision_date date,
                  add column baseline jsonb;
```

**Added in the final pass**

```sql
create table discussions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  kind text not null,                               -- standup | weekly | adhoc
  question text, status text not null default 'open', opened_at timestamptz not null default now()
);
create table discussion_turns (
  id bigserial primary key, discussion_id uuid not null references discussions(id),
  speaker text not null, round smallint not null, body text not null,
  evidence jsonb not null default '[]', at timestamptz not null default now()
);
create table decisions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  discussion_id uuid references discussions(id), title text not null, decision text not null,
  owner text, due date, decided_at timestamptz not null default now()
);
create table deployments (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  project_id uuid references projects(id), repo_url text not null, live_url text,
  commit_sha text, environment text not null default 'preview', status text not null,
  screenshot_url text, approval_id uuid references approvals(id), deployed_at timestamptz not null default now()
);
create table hooks (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  pattern text not null, example_url text, platform text, notes text, found_at timestamptz not null default now()
);
create table video_ideas (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  source text not null,                             -- founder | hook_scout
  idea text not null, hook_id uuid references hooks(id),
  stage text not null default 'idea',               -- idea | brief | assets | render | review | published
  content_item_id uuid references content_items(id), created_at timestamptz not null default now()
);
```

**Added in v5**

```sql
create table catalog_sources (                      -- where personas come from
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  key text not null, repo_url text not null, commit_sha text not null,
  license text not null, attribution text not null, imported_at timestamptz not null default now(),
  unique (workspace_id, key)
);

create table catalog_personas (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  source_id uuid not null references catalog_sources(id),
  key text not null, name text not null, division text, description text,
  body text not null, body_sha text not null,
  scan_flags jsonb not null default '[]',           -- lines the import scan flagged
  unique (workspace_id, key)
);

create table bakeoffs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  department_id uuid references departments(id), gap text not null,
  trial_task_id uuid references tasks(id), status text not null default 'running',  -- running | scored | proposed | closed
  created_at timestamptz not null default now()
);

create table bakeoff_candidates (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  bakeoff_id uuid not null references bakeoffs(id), persona_id uuid not null references catalog_personas(id),
  template_key text not null, run_id uuid references runs(id),
  check_passed boolean, reviewer_score smallint, cost_usd numeric(10,4), boundary_attempts int not null default 0,
  reason text
);

create table agent_scorecards (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  agent_id uuid not null references agents(id), week date not null,
  tasks_done int, checks_passed int, accepted int, edited int, rejected int,
  cost_per_accepted_usd numeric(10,4), boundary_attempts int, verdict text,  -- keep | patch | swap_persona | bench
  unique (workspace_id, agent_id, week)
);

alter table agents add column persona_id uuid references catalog_personas(id),
                   add column hire_status text not null default 'active';   -- trial | active | benched | terminated
```

Each of these follows the tenancy rule: row-level security forced, and the server's role does not own them. They arrive with slice 8.

**Atomic task checkout**

```sql
update tasks set status = 'in_progress', locked_by = :agent, locked_at = now()
where id = (
  select id from tasks
  where assignee_id = :agent and status = 'todo'
  order by priority, created_at
  for update skip locked limit 1
)
returning *;
```

**Events**

| Event | Sent when | Starts |
| --- | --- | --- |
| `agent/heartbeat` | The ticker, for each agent that is due | A run |
| `task/assigned` | A task gets an assignee | A run |
| `message/received` | You or an agent messages an agent | A run |
| `inbox/reply.received` | A lead replies | Reply triage |
| `approval/requested` | A proposal tool is called | The gate workflow |
| `approval/decided` | You press approve or reject | Resumes the gate |
| `run/finished` | A run ends | Reflect pass, budget check |
| `budget/exhausted` | Spend reaches the cap | Pauses the agent, raises an action item |

**One event starts every run.** A heartbeat, a task assignment, a message and `POST /agents/:id/run` all send `agent/run.requested`, and the `agent-run` function is the only thing that starts a run. Heartbeats come from one ticker function on a one-minute cron. It reads each agent's `heartbeat_cron` and sends the event for those that are due.

**API**

| Route | Does |
| --- | --- |
| `GET /office` | Departments, agents and their live status for the canvas |
| `GET /departments/{id}` | Board, agents, feed, numbers |
| `GET, PATCH /agents/{id}` | Role, budget, autonomy, pause and resume |
| `POST /agents/{id}/message` | Send the agent a message |
| `POST /agents/{id}/run` | Fire a heartbeat now |
| `GET, POST /tasks`, `PATCH /tasks/{id}` | Task board |
| `GET /runs/{id}`, `WS /runs/{id}/stream` | Run log and live stream |
| `GET /approvals?status=pending` | The inbox |
| `POST /approvals/{id}/decide` | Approve, edit and approve, or reject |
| `GET, POST /leads`, `PATCH /leads/{id}` | Pipeline |
| `GET, POST /content` | Calendar |
| `GET /calls`, `POST /calls/{id}/outcome` | Call list and results |
| `GET /opportunities`, `GET /findings` | Research feed |
| `GET, POST /skills`, `GET, POST /mcp` | Registries |
| `GET /metrics` | Dashboard numbers |
| `GET /audit` | Audit log |
| `WS /events` | Office-wide live events |
| `POST /webhooks/{source}` | Inbound email, Retell, Inngest |

Routes added in v2: `/accounts`, `/contacts`, `/deals`, `/campaigns`, `/threads`, `/channels`, `/projects`, `/plugins`, `/delegate`, `/health`, `/workspace/export` and `/workspace/import`, plus `POST /kill-switch`, which pauses every agent and executor at once.

Routes added in v3 and the final pass: `/goals`, `/discussions`, `/decisions`, `/deployments`, `/signals`, `/improvements`, `/templates`, `/video-ideas`, `/pipeline-stages`, `/auth` and `/devices`.

## 12. Frontend

A Next.js app with two layers: a Phaser canvas for the office world, and normal React panels on top for everything you read and click.

**Stack.** Next.js App Router, TypeScript, Tailwind, shadcn/ui, Phaser 4 for the office world, Zustand for state, TanStack Query for data, xterm.js for live run output, Framer Motion for panel transitions. Phaser is what WorkAdventure uses, and it has tilemaps, cameras and simple physics built in, which a walkable world needs. jsm-hq uses Pixi.js, the same state library and the same terminal, so its MIT code is still a working reference for the panels and the drawer. Draw your own sprites and use your own name, because its name and logo are not covered by the license and I did not check how its art is licensed.

**This UI is version one.** The canvas is a thin view over the same store the panels use. It holds no business logic, so you can redraw it, restyle it or replace it with a different office later without touching the backend.

**How it goes beyond jsm-hq**

| jsm-hq | Conclave AI OS |
| --- | --- |
| One room, one coding team | A floor of rooms, one per department, with a zoomed-out company view |
| Agents sit at desks | Agents show state on the canvas: working, waiting on you, blocked, idle, over budget |
| Task board on the wall | Each room's wall shows its own board and its number for the week |
| PRs on a review belt | An approvals tray at the office door, with a count you cannot miss |
| Drawer with terminal and task | Drawer with live run, tasks, messages, memory, skills, MCP, budget |
| No business data | Pipeline, content calendar, calls, research and metrics screens |

**Screens**

| Screen | What is on it |
| --- | --- |
| Office | The world. Walk between rooms or click one. Rooms light up when work is running, and agents move with their work |
| Department | Lead agent chat, task board, live feed, this week's numbers, agents list |
| Agent drawer | Tabs: Live (run stream or terminal), Tasks, Messages, Memory, Skills and Connectors, Budget, Role file |
| Approvals | Cards grouped by kind. Preview, edit in place, approve, reject with a note. Keyboard shortcuts for speed |
| Pipeline | Deals as a board by stage for each funnel, with conversion and days in stage. Leads are the list that feeds it |
| Content | Calendar by platform, with draft, approved, scheduled and published states |
| Calls | Today's call list with openers, a click-to-call button, outcome buttons, AI call transcripts |
| Research | Daily findings and scored micro-SaaS ideas, each with its evidence links |
| Founder Network | People, the last touch, the next nudge, drafts waiting for you |
| Dashboard | Leads generated, messages sent, replies, meetings, calls, posts, cost. By department and by week |
| Settings | Runtimes, model aliases, connectors, plugins, skills, channel accounts, budgets, users |
| Audit | Every action, filterable by agent, kind and date |

Screens added in v2:

| Screen | What is on it |
| --- | --- |
| Clients | Accounts with stage, health, open deals, last touch and the project for each won client |
| Campaigns | Each campaign's audience, sequence, sender, daily cap, status and results, with pause and resume |
| Inbox | One thread per contact across email, DMs and calls, with replies waiting for triage on top |
| Plugins | Installed plugins, their skills, hooks and connectors, and which agents have them |
| Delegate | The mandate, the signature fingerprint, the ledger and the weekly digest |
| Health | Runtimes, connectors, channel accounts, queue depth, failed runs, and the kill switch |
| Setup | First-run wizard: name the company, pick a template, connect a model, connect channels |

Screens added in the final pass:

| Screen | What is on it |
| --- | --- |
| Goals | The ladder, the current rung, required against actual activity, and each department's number |
| Boardroom | Stand-up posts, the weekly review, open discussions and the decision log |
| Deployments | Every site and app the company has shipped: client, repo on your GitHub, live URL, preview screenshot, last deploy, status and who approved it |
| Video Ideas | Your idea inbox, hook patterns with links, each video's stage from brief to published, and results |

New repos are created under your GitHub account by an approved action, and every deploy is an approval. So the Deployments screen lists everything shipped through the OS. A deploy made by hand elsewhere will not appear.

**Live updates.** The app opens one WebSocket to `/events`. Run events update the agent's sprite and feed, approval events update the tray count, and task events move cards. The canvas reads from the same Zustand store as the panels, so they never disagree.

**Agent states on the canvas**

| State | Shown as |
| --- | --- |
| Working | Typing at the desk, with a one-line caption of the current step |
| Waiting on you | Standing at the approvals tray, card in hand |
| Blocked | A question mark over the desk. Click to read the question |
| Idle | Away from the desk |
| Over budget or paused | Desk dimmed |

**Phone and remote access.** You can open the OS from your phone at home and away, for as long as the machine running it is on. The phone is a window onto that machine. Nothing runs on the phone itself.

| Where you are | How the phone reaches the OS | What it needs |
| --- | --- | --- |
| At home, same Wi-Fi | The same private network address as when away, over HTTPS, because passkeys and the installed app need it | Remote access switched on, and login |
| Away from home | A private network between your own devices, such as Tailscale, installed on the laptop and the phone | The same login. Nothing is opened to the public internet |
| Away, without installing anything on the phone | A tunnel to a web address on your own domain, behind a login wall, such as Cloudflare Tunnel with Access | Your domain, and more care, because the address is public |
| When the laptop is off | Nothing | A small always-on server later, in team mode |

My default is the private network. Never forward a port on your router to the OS.

**What changes when remote access is on**

- **Login is required.** Local mode has no login because it only answers on the laptop itself. The moment the OS listens on the network, every request needs a signed-in session. Use a passkey, with a list of signed-in devices you can revoke.
- **The phone gets less power than the laptop.** It can read everything, approve, edit, reject, message agents, join the Boardroom and press the kill switch. It cannot see or change secrets, install plugins, change the delegate's mandate or open a shell.
- **Every approval records the device it came from.**

**The phone app.** The web app installs to your home screen as a progressive web app, so there is no app store step. Five screens are built phone-first: the morning brief, approvals, the inbox, goals and video review. The kill switch is on every screen. The office canvas stays on the desktop.

**Notifications.** Push notifications from the installed app for three things only: the morning brief, a failed executor, and an approval that is about to expire. If push proves unreliable on your phone, the fallback is a message from a bot in a chat app that carries a link back to the approval. Approving happens in the OS, never by replying in the chat.

**Keeping the machine awake.** The laptop must not sleep while agents are scheduled. `doctor` checks the sleep settings and warns you, and the OS shows "last seen" on the phone so you can tell a sleeping laptop from a quiet company.

**The office, WorkAdventure-style.** You want the office to feel like [WorkAdventure](https://github.com/workadventure/workadventure): a top-down world drawn from tiles where you walk your own avatar between rooms. WorkAdventure is built with Phaser and Svelte, its maps are made in the Tiled editor, and it adds video calls when people walk close to each other. The OS keeps the walking, the rooms and the maps, and replaces the people you call with the agents you manage.

**Do not copy WorkAdventure's code or maps.** Its license is the GNU Affero GPL version 3 with the Commons Clause. The Affero license would require you to publish the source of the whole OS to anyone who uses it over a network, and the Commons Clause forbids selling a product that is substantially its software. Section 16 plans to sell the OS. So read WorkAdventure for ideas only, write the office yourself on Phaser, and draw maps yourself or use tiles you are allowed to sell with. Kenney's game assets are public domain, for example, and many paid tile packs allow commercial use. jsm-hq's MIT code is still a fair reference, but its name and logo are not.

| WorkAdventure has | In the OS |
| --- | --- |
| A Tiled map of rooms | The office map is a Tiled JSON file per workspace. Each room is a named area linked to a department key, and each desk is a numbered slot |
| Your avatar walks the map | You walk as the CEO. Click a spot to walk there, or use the arrow keys |
| Walk up to someone and a video bubble opens | Walk up to an agent and its drawer opens: live run, tasks, a chat box. No video and no voice, so no media server to run |
| Areas that open a website when you enter | Enter a room and its department panel slides in: board, numbers, waiting approvals |
| Objects you can use | The approvals desk by the door, a whiteboard with the goal ladder, a screen with the dashboard, a mailbox for the inbox, a job board in the Talent room with candidates and bake-offs, the Boardroom table |
| Many people in one world | Your co-founder sees the same office live, with an avatar of her own |
| An in-browser map editor | Edit the map in Tiled. A new hire gets the next free desk slot by itself, and a new department needs a room drawn once |

**Agents move with their work.** An agent walks to its desk when a run starts, stands at the approvals desk while waiting for you, walks into the Boardroom for a meeting, and goes to the lounge when idle. Movement is driven by the same run and approval events the panels use, so the world is never out of step with the data.

**The office is never the only way in.** Every action in the world is also a button on a plain screen. On a phone the office shows as a small map with the rooms listed, and the canvas stops drawing when the tab is hidden.

## 13. Repo layout

One pnpm monorepo, so the OS, its plugins and each company are versioned together.

```text
conclave-os/
  apps/
    server/                   # Node API + harness host
      src/
        index.ts
        config/               # models.ts, limits.ts, feature flags
        db/                   # drizzle schema, migrations, row-level security
        tenancy/ org/ work/ crm/ channels/ content/ projects/
        calls/ research/ memory/ plugins/ ledger/ metrics/ reliability/
        harness/
          context.ts          # builds the per-run prompt
          loop.ts             # checkout, run, verify, report, reflect
          render.ts           # template renderer: role files and working folders, one target per runtime
          policy.ts           # deny rules, budget, autonomy
          os-tools.ts         # handlers for the `os` MCP server (HTTP for CLI runtimes, in-process for claude-agent)
          verify.ts           # output checks, repair, model escalation
          reflect.ts
        runtimes/
          types.ts cli.ts http.ts conformance.ts
          openai-agents.ts    # slice 4
          claude-agent.ts     # slice 9
        approvals/
          gate.ts delegate.ts
        actions/              # deterministic executors, no model
          email.ts post-x.ts post-instagram.ts post-linkedin.ts
          dm-x.ts dm-instagram.ts render-video.ts
          repo-create.ts deploy.ts call.ts hire.ts skill-patch.ts plugin-install.ts
        workflows/            # Inngest functions
          ticker.ts agent-run.ts approval-gate.ts reply-triage.ts sequence.ts
          daily-study.ts weekly-retro.ts gap-check.ts reaper.ts backup.ts
        routes/
      test/
    web/                      # Next.js
      app/                    # office, approvals, clients, campaigns, inbox, ...
      office/                 # Phaser world: Tiled map loader, avatars, areas, objects
      lib/                    # typed api client, ws client, store
  packages/
    shared/                   # zod schemas and types used by server and web
    cli/                      # start, doctor, agent:new, export, import
  plugins/                    # built-in plugins in Claude Code plugin format
    os-core/ leadgen-kit/ outreach-kit/ content-kit/
    video-kit/ dev-kit/ research-kit/ calls-kit/
  catalog/                    # imported personas, one folder per source, each with its LICENSE
  templates/
    agents/                   # agent templates: lead/ researcher/ writer/ scout/ ...
    companies/                # company templates: agency-starter/ saas-founder/ course-creator/
  company/                    # tracked in git: the company as text
    COMPANY.md
    goals.yaml
    departments.yaml
    departments/<dept-id>/agents/<agent-id>/AGENT.md
  workers/
    python/                   # optional FastAPI workers for the http runtime
  docs/                       # SPEC.md, BUILD.md, DECISIONS.md
  docker-compose.yml          # team mode: server, web, postgres, inngest
  .env.example

~/.conclave-os/               # DATA_DIR, outside the repo on purpose
  postgres/  files/  browser-profiles/
  workspaces/<slug>/
    agents/<agent-id>/        # working folder, rendered for the agent's runtime
    office.tmj                # the Tiled office map
```

Two folders, two jobs. `company/` is text you review and keep in git. The data directory holds everything generated or private, and sits outside the repo so agent folders never inherit the repo's own `CLAUDE.md`. In local mode there is one workspace and its company folder is `company/`. In team mode each workspace points at its own company folder.

A company is a folder of text. A hire is a new `AGENT.md`, so every change to the company has review, history and rollback.

## 14. Reliability and error handling

Assume every step can fail, and decide in advance what happens when it does. The book sorts agent failures into four classes: the agent did not know, was not stopped, was not checked, or planned badly. The table adds the infrastructure failures around them.

| Failure | How it is detected | What the OS does |
| --- | --- | --- |
| Model API error or rate limit | Error from the runtime | Step retry with backoff, then the fallback model alias, then the task is blocked with the reason |
| Tool or connector error | Tool result marked failed | Retry if the error is transient. Otherwise the agent is shown the error once. Three failures in a row open that connector's circuit breaker |
| Connector login expired | Health check, or an auth error | Connector marked unhealthy, dependent tasks wait, one action item asks you to reconnect |
| Agent loops or wanders | `max_turns`, run time limit, budget | Run stops with a summary of where it got to. The task keeps its session id so it can resume |
| Wrong or malformed output | Output check fails | One repair attempt showing the error, then the stronger model, then a blocked task for you |
| Run process dies | `heartbeat_at` goes stale | A reaper marks the run failed, releases the task lock and requeues it. Third failure blocks the task |
| The same action runs twice | Executor claims the approval first | `update approvals set status = 'executing' where id = $1 and status = 'approved'`. No row back means someone else has it |
| Executor fails halfway | Exception, or the read-back check fails | Never a blind retry of a post or send. Screenshot saved, approval marked failed, action item raised |
| Browser session expired | Login page detected | Executor stops before acting and asks you to log in |
| Approval never decided | Wait times out | Card expires, task returns to todo with a note |
| Budget exhausted | Ledger check before each run | Agent paused, action item raised |
| A role, skill or plugin change makes things worse | Evals run before the change ships | The change is blocked. Old versions stay in git for rollback |
| Bad instruction hidden in web or email text | Policy hook and the proposal design | Tool output is data. Agents can only propose, and you see the full payload |
| Data loss | Scheduled backup job | Daily database dump and a git commit of the company folder |
| Upgrade breaks a workspace | Versioned migrations | Export before upgrade, and `doctor` checks the install |

**Run states.** `queued`, `running`, `waiting_approval`, `succeeded`, `failed`, `cancelled`, `timed_out`. Every transition is a row in the audit log.

**Limits that protect your machine and accounts**

```ts
// workflows/agent-run.ts
export const agentRun = inngest.createFunction(
  {
    id: 'agent-run',
    retries: 2,
    concurrency: [
      { limit: 2 },                                    // at most two agents running at once
      { limit: 1, key: 'event.data.agentId' },         // never the same agent twice
    ],
  },
  { event: 'agent/run.requested' },
  async ({ event, step }) => { /* checkout, run, verify, report, reflect */ },
);

// workflows/sequence.ts: sends are throttled per sender, not per agent
// throttle: { limit: 20, period: '1d', key: 'event.data.channelAccountId' }
```

**The kill switch.** One button pauses every agent, cancels queued runs and stops every executor. It is the first thing to build after the first executor.

**The ratchet.** Every failure ends as a permanent fix: a new deny rule, hook, output check or eval case. The book's term for this habit is the ratchet, and it is how the harness gets stronger while the model stays the same.

**Seeing what happened.** Each run keeps its full trace: every tool call, result, cost and decision. The Health screen shows queue depth, failure rate by agent, connector state and spend against budget.

## 15. Risks and hard rules

The biggest risk is not technical. It is losing the X and Instagram accounts, or your sending domain, in the first month. I am not a lawyer, so treat the legal points as things to confirm.

| Risk | Why it matters now | Rule built into the OS |
| --- | --- | --- |
| Account bans on X and Instagram | @conclaveai\_pro has 0 posts and 0 followers. New accounts that send automated or bulk cold DMs are the ones platforms restrict first | DMs are drafted and queued. You send each first DM yourself, or approve it one at a time, under a small daily cap that grows slowly. No bulk follow or like actions |
| Cold DMs through official APIs | As far as I know, Instagram's messaging API is for replying to people who messaged you first, not for cold outreach. Check Meta's current docs | Use the API for replies and comments. Use email for cold first touch |
| Cold email rules | US commercial email generally needs a real postal address, an honest subject and a working opt-out | The pre-send check fails if the footer address is a placeholder. Every opt-out goes to the suppression table, and executors refuse suppressed addresses |
| Sender reputation | A new domain that sends many cold emails lands in spam | Warm up slowly, cap sends per day per mailbox, and stop a sequence on any bounce or complaint |
| AI voice calls to US numbers | In February 2024 the FCC ruled that AI-generated voices count as artificial voices under the TCPA, which generally requires prior consent | AI calls only to people who enquired or opted in. For cold calls, the Calls Desk prepares the list and opener and a human dials. Get legal advice before any outbound AI campaign |
| Prompt injection | Agents read websites, replies and scraped posts, and that text can contain instructions | Tool output is data. Agents can only propose. Executors send only to recipients already in your tables, and you see the full payload on the card |
| Runaway cost | A loop can burn a month of budget in a night | Per-agent monthly budget, `max_turns` per run, a daily company cap, and an automatic pause on the third failed run in a row |
| Secrets | Tokens in prompts leak into logs and outputs | Secrets live in the encrypted secrets table, unlocked by one key from the environment, and are injected by executors and connectors only. Agent processes start with a clean environment. Browser sessions live in profiles. Nothing stores a password |
| Scope | Eighteen departments is a lot for one developer, and Vespera still needs customers | Build in the order of section 18 and stop adding rooms until the last one produces something you use every week |
| Scraping | Site terms and privacy laws limit what you may collect and keep | Collect business contact data only, record the source of every lead, and honour removal requests |

**Medical claims.** Your med spa agents already hard-stop on clinical questions. Keep that rule in every Outreach and Marketing role file, and enforce it in the proposal handler with a term list first and a reviewer pass second. The approval card shows any flagged sentence. The rule: no medical advice, no treatment claims, no invented pricing.

**Scouting on Reddit and X.** The scouts only read, through an approved scraper or API, within each site's terms. Replies are drafted for you and you post them yourself, as a person, with help first and the offer second. Accounts that post promotional replies in volume get banned, and a ban from a community is usually permanent.

**Running on a subscription.** Covered in section 7: expect limits, and check the terms on automated use.

## 16. Giving the OS to other people

The OS is built so a teacher, a client or another founder can install it and run a different company on it without touching code.

| Need | How the OS meets it |
| --- | --- |
| Easy install | Local mode: one `npx` command starts the server, UI, an embedded database and the workflow engine. No account, bound to localhost |
| Teams | Team mode: hosted with Docker, real Postgres, login, and roles of owner, admin, member and viewer |
| A different business | Departments, agents, rooms, pipeline stages, approval rules and mandates are data. A teacher can rename Outreach to Admissions and retire Calls Desk from the settings screen |
| A fast start | Company templates. A template is an exported company folder plus its plugin list, with secrets removed. Ship three: agency starter (yours), SaaS founder, course creator |
| First run | A setup wizard: name the company, pick a template, connect a model, connect channels, approve the first hire |
| Their own model | A CLI they signed in to themselves, a local model or an API key. The OS never asks for, stores or passes on a Claude login (section 7) |
| Their own tools | The plugin and connector registries, and a marketplace that is just a git repo you publish |
| Safe upgrades | Versioned migrations, a `doctor` command, and export before upgrade |
| Moving or backing up | `export` writes the whole workspace to a folder. `import` restores it on another machine |
| Their own look | The office map is a Tiled file, and colors and logo are workspace settings |

**Design rules that make this possible**

- **Nothing about Conclave is hard-coded.** Conclave AI is the first workspace and the first template, not the product.
- **Open formats at every seam.** Skills, plugins, MCP, markdown role files, Postgres. If the OS disappeared, the company folder would still work in Claude Code.
- **Adapters where things change fastest:** runtimes, models, channels and storage. A new model or platform is a new adapter, not a rewrite.
- **Safe defaults for strangers.** New workspaces start with every agent at autonomy 0 or 1, the delegate off, and small send caps.

**Check before you sell it.** I am not a lawyer. The Claude Agent SDK is covered by Anthropic's commercial terms, and its docs say your product must keep its own branding and not present itself as Claude Code. Remotion has its own license terms. Each platform's rules on automation apply to your users too, so the limits in section 15 must ship switched on.

## 17. Memory and cost footprint

Agents are rows in a table, not running programs. An idle agent uses no memory, so twenty agents on the org chart cost the same as two until they run.

| What uses memory | Runs | Weight | How it stays small |
| --- | --- | --- | --- |
| A local model | All day, once the scouts use it | Heaviest by far, set by the model's size | One model loaded at a time, a small tool-calling model, or use an API model instead |
| A browser | During a site audit or a posting job | Heavy | One browser at a time, closed after each job |
| A video render | During a render | Heavy but short | One render at a time, queued |
| An agent run | Only during a run | Moderate, one process per run | At most two runs at once, set in the workflow engine |
| The database | Always | Small | Embedded, with small buffers in local mode |
| The server and UI | Always | Small | Run the production build, not the dev server |
| The workflow engine | Always | Small | One local process |
| The office canvas | While that tab is open | In the browser | Stops drawing when the tab is hidden. Every screen works without it |

I have not measured these, so slice 0 includes a `doctor` command that prints real numbers on your machine. A lite mode setting gives one run at a time, no local model and the canvas off.

**Keeping token cost down**

- **No task, no model call.** A heartbeat first checks in plain code whether the agent has work. Most heartbeats then cost nothing.
- **Cheap model first.** Research and triage run on a cheap or local alias. Writing and planning use the stronger one.
- **Short contexts.** Agents load only the lessons and skills that match the task.
- **Budgets with hard stops,** per agent and for the whole workspace.
- **Code instead of model** for everything that is a fixed procedure: sending, rendering, scoring by rule, counting.

## 18. Build order

Ten slices, each usable on its own. The first three bring in clients, the fourth makes it dependable, and the office comes after that.

| # | Slice | You build | Done when | Agent Factory chapter to read first |
| --- | --- | --- | --- | --- |
| 0 | Skeleton | Monorepo, workspace tables with row-level security, embedded Postgres, the `claude-cli` and `opencode` runtimes behind one runner, the runtime conformance tests, the template renderer with one render target per runtime and three templates (lead, researcher, writer), `os-core` plugin, run log, a plain task page, `doctor` | One agent made from a template takes a task and runs, the same template runs on the second engine after a one-line change, you can read every step, and `doctor` prints memory use | [Harness Engineering](https://agentfactory1.panaversity.org/docs/harness-engineering-crash-course), [Workforce with Paperclip](https://agentfactory1.panaversity.org/docs/workforce-with-paperclip-crash-course) |
| 1 | Approvals and Outreach | Proposal tools, gate workflow, approvals inbox, `outreach-kit`, email executor with the claim-once rule, suppression list, kill switch, login and phone access over a private network | A lead goes from audit to approved email to sent, the kill switch stops everything, an agent told to send an email by any other route fails, and an approval decided after a restart still sends exactly once | [AI Agent Nervous System](https://agentfactory1.panaversity.org/docs/ai-agent-nervous-system-crash-course) |
| 2 | Clients, funnels and Lead Gen | Accounts, contacts, deals, both funnels as stage rows, campaigns, threads, the inbox, `leadgen-kit`, heartbeats, throttled sequences, the Goals screen, the morning brief, the deal desk and client success templates | New scored leads arrive every morning, a reply pauses its sequence, and the pipeline shows conversion by stage | [Selling as a Vertical FDE](https://agentfactory1.panaversity.org/docs/how-to-sell-agentic-ai-era) |
| 3 | Reliability | Output checks, repair and escalation, the reaper, circuit breakers, plan-limit handling, the Health screen, an eval set of 20 real leads, a daily backup, lite mode | You can kill a run halfway and it resumes, a plan limit pauses agents cleanly, and a skill change that hurts the 20 leads is blocked | [Eval-Driven Development](https://agentfactory1.panaversity.org/docs/eval-driven-development-crash-course) |
| 4 | A local model, all day | The `local-worker` alias on the `openai-agents` runtime with its skill loader, the scout template, the signals table, Demand Radar and the Micro-SaaS problem scout switched on, escalation to Claude when a check fails | Scouts run around the clock on your machine and you get a short list of qualified signals each morning | [Deploy the Agent Harness](https://agentfactory1.panaversity.org/docs/deploying-agents-crash-course) |
| 5 | Marketing, browser and video | `content-kit`, `video-kit`, browser profiles, post executors for X, LinkedIn and Instagram, approved-DM executors for X and Instagram that send one at a time, the Video Ideas inbox, the Hook Scout, a generation connector, the home-screen app and push | You approve a post or a video on your phone and it is live, with a screenshot in the record | [Designing Agent Experiences](https://agentfactory1.panaversity.org/docs/designing-agent-experiences-crash-course) |
| 6 | The office | Phaser world, Tiled map loader, your avatar, rooms as areas, agents that move with their work, objects for approvals, goals, dashboard and inbox, live presence for your co-founder, agent drawer, the Boardroom with discussions and the decision log | You walk from the door to the Outreach room, open an agent by walking up to it, and approve a card at the approvals desk | [Human-Agent Teams](https://agentfactory1.panaversity.org/docs/human-agent-teams-crash-course) |
| 7 | Engineering and Product | `dev-kit`, worktrees, GitHub and Vercel connectors, the `opencode` and `codex` runtimes for coding work (`opencode` itself was wired in slice 0), Frontend Studio, Product room, repo-create and deploy executors, the Deployments screen | A spec becomes a PR with a preview link waiting for your merge | [Plugins for AI Agents](https://agentfactory1.panaversity.org/docs/plugins-crash-course) |
| 8 | Learning, hiring, the delegate and Research | Memory, reflect pass, the talent catalog with its first import, bake-offs, hiring levels H0 and H1, weekly scorecards, the Talent room, approve-and-teach, skill patches, the monthly audit, gap check and `propose_hire`, the delegate with its mandate and ledger, the Research room and improvement proposals, Founder Network | An edit you make changes the next draft, the Talent room runs a bake-off between three catalog candidates and proposes the winner, the delegate clears one routine approval and refuses one outside its limit, and Research proposes a change that passes its eval | [Self-Expanding Workforce](https://agentfactory1.panaversity.org/docs/dynamic-workforce-crash-course), [Identic AI](https://agentfactory1.panaversity.org/docs/identic-ai-crash-course), [Hermes with General Agents](https://agentfactory1.panaversity.org/docs/hermes-with-general-agents) |
| 9 | API keys and a product for others | The `claude-agent` and `http` runtimes, team mode and roles, setup wizard, company templates, export and import, plugin marketplace, Calls Desk | Someone else installs it with their own key or local model and runs a different company from a template | [Build AI Agents (Claude)](https://agentfactory1.panaversity.org/docs/claude-agent-sdk-crash-course), [AI Identity](https://agentfactory1.panaversity.org/docs/ai-identity-crash-course) |

**Before slice 0, this week, with no code**

- [ ] Post 3 to 5 posts on @conclaveai\_pro, add a banner and the website link. An empty account should not start outreach.
- [ ] Decide the footer address for cold email.
- [ ] Write `COMPANY.md`: mission, the two offers, target markets and the rules from section 15.
- [ ] Fill in every TODO in the company folder: the offers, the prices, the footer address and the goals.
- [ ] Run Claude Code headless once on a small task.
- [ ] Read the Paperclip chapter and run its scenarios once. They show you the management rules you are about to rebuild.

**Stop rule.** Do not start a slice until the one before it is something you use every week. Slices 0 to 3 are the product. Everything after them is growth.

## 19. Open decisions

You have now decided how models are paid for: signed-in CLIs first, a local model next, API keys later. Fourteen choices remain. Numbers 1 and 3 block slice 0, number 2 blocks slice 4, and number 5 blocks the first send.

| # | Decision | My default | Why it matters |
| --- | --- | --- | --- |
| 1 | Which signed-in CLIs, on which account | Claude Code on the account with a paid plan. OpenCode signed in with a ChatGPT or Copilot plan if you have one, otherwise on a local model | Slice 0 runs on whatever is logged in on the machine |
| 2 | Which local model | The largest tool-calling model your machine runs comfortably, tested in slice 4 | Sets how much the all-day scouts can be trusted with |
| 3 | Where it runs | Your own machine. It must stay on for the scouts and the heartbeats | Browser profiles and the local model live there |
| 4 | Database in team mode | Supabase | You already use it |
| 5 | Cold email footer address and sender | A virtual mailbox for the address. Send through a dedicated sending service on a separate domain, to protect the main domain's reputation | Blocks the first real send |
| 6 | Who approves what | You approve everything. Your co-founder can approve content and outreach | Sets roles |
| 7 | The delegate's first mandate | Follow-ups inside an approved sequence, nothing else | The safest place to learn how much you trust it |
| 8 | The free offers | Services: the homepage concept. Vespera: one slice session on their own enquiries | Both funnels hinge on a free step that is small and written down |
| 9 | Who signs off the med spa rules | A practitioner you know, named in the record | Vespera's safety rules need an expert's name on them before a pilot |
| 10 | Product name and license | Decide before slice 9. Keep "Conclave" for your company and give the OS its own name | Affects the repo, branding and what others may do with it |
| 11 | Second company template | Course creator, tested with one of your teachers | The first proof that the OS is not Conclave-shaped |
| 12 | Hiring level | H0 until slice 8 has run a month of scorecards, then H1 | How much the company grows without you |
| 13 | Roster cap | 20 active agents | Plan limits and memory |
| 14 | Catalog sources | Agency Agents first, then the Paperclip companies that match a switched-on department | Every source is text from strangers that your agents will read |

## 20. Building this with Claude Code

This document is the spec. Build it one slice at a time, and never ask Claude Code to build all of it at once.

**Set up the repo**

1. Create an empty repo with four things in it: this spec saved as `docs/SPEC.md`, the `CLAUDE.md` file, `docs/BUILD.md` with the slice 0 tasks, and the `company/` starter folder. Everything except the spec comes in the starter folder, together with a README, the decisions log, a departments file and an env example.
2. Start Claude Code in the repo and paste the kickoff prompt from `docs/BUILD.md`.

**Rules for every session**

- **One branch per slice, one task per session, plan before code.**
- **The "Done when" column in section 18 is the acceptance test.** A task is finished when its test passes, not when the code exists.
- **Never build ahead of the current slice,** even where the spec describes the later part.
- **When the spec and the code disagree, fix the spec first.** Record the change in `docs/DECISIONS.md`.
- **Check current docs before using any SDK call or CLI flag from this spec.** The code samples here are sketches.
- **Secrets never go in the repo.** `.env.example` lists names only.
- **Commit after every passing task.**

**Keep sessions small.** This spec is long, and reading all of it into every session wastes context. `CLAUDE.md` tells Claude Code to read only the sections a task names.

**Flexible by construction.** A new department is a folder and a room on the map. A new agent is a template filled in. A new tool is a plugin or a connector. A new funnel is a set of stage rows. A new company is a template. A new environment is a new workspace, or a new deploy target on a project. If a change you want needs code in the core, treat that as a gap in the design and write it into the spec first.

## 21. Sources

Pages I opened:

- [jsm-hq README](https://github.com/jsmastery-pro/jsm-hq), [How JSM HQ works](https://github.com/jsmastery-pro/jsm-hq/blob/main/docs/how-it-works.md) and [package.json](https://github.com/jsmastery-pro/jsm-hq/blob/main/package.json)
- [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk.md), Claude Code docs
- [Anthropic compatibility](https://docs.ollama.com/api/anthropic-compatibility), Ollama docs
- [Agency Agents](https://github.com/msitarzewski/agency-agents) and [Paperclip companies](https://github.com/paperclipai/companies), read from a clone of each
- [Paperclip README](https://github.com/paperclipai/paperclip), read from a clone
- [WorkAdventure](https://github.com/workadventure/workadventure), its `play/LICENSE.txt` and `play/package.json`, read from a clone
- [Phaser 4.2.1 README](https://cdn.jsdelivr.net/npm/phaser@4.2.1/README.md) and [Kenney asset license](https://kenney.nl/support)
- [Other LLM gateways](https://code.claude.com/docs/en/llm-gateway) and [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance.md), Claude Code docs
- [Models](https://openai.github.io/openai-agents-js/guides/models), OpenAI Agents SDK for TypeScript docs
- [Skills](https://opencode.ai/docs/skills.md), [Agents](https://opencode.ai/docs/agents/), [Instructions](https://opencode.ai/docs/instructions/), [MCP servers](https://opencode.ai/docs/mcp-servers/) and [Providers](https://opencode.ai/docs/providers/), OpenCode docs
- [Anthropic on third-party harnesses and Claude subscriptions](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access), The Register
- [Mode 2: Manufacturing](https://agentfactory1.panaversity.org/docs/mode-2-manufacturing), The AI Agent Factory

Read through the Agent Factory System of Record:

- [Harness Engineering](https://agentfactory1.panaversity.org/docs/harness-engineering-crash-course) and [Deploy the Agent Harness](https://agentfactory1.panaversity.org/docs/deploying-agents-crash-course)
- [Identic AI](https://agentfactory1.panaversity.org/docs/identic-ai-crash-course) and [Self-Expanding Workforce](https://agentfactory1.panaversity.org/docs/dynamic-workforce-crash-course)
- [AI Agent Nervous System](https://agentfactory1.panaversity.org/docs/ai-agent-nervous-system-crash-course), [Building a Digital FTE](https://agentfactory1.panaversity.org/docs/digital-fte-crash-course) and [Workforce with Paperclip](https://agentfactory1.panaversity.org/docs/workforce-with-paperclip-crash-course)
- [Glossary](https://agentfactory1.panaversity.org/docs/glossary), [Thesis](https://agentfactory1.panaversity.org/docs/thesis) and [Hermes with General Agents](https://agentfactory1.panaversity.org/docs/hermes-with-general-agents)

I searched these chapters and read the matching passages, not every chapter end to end.

Added for v3, also through the System of Record: [Selling as a Vertical FDE](https://agentfactory1.panaversity.org/docs/how-to-sell-agentic-ai-era), [System of Context](https://agentfactory1.panaversity.org/docs/ecosystem/system-of-context), [The FDE AF Model](https://agentfactory1.panaversity.org/docs/ecosystem/fde-af-model) and [What You Carry In](https://agentfactory1.panaversity.org/docs/what-you-carry-in).

Added in the final pass, through the System of Record: [Getting Paid as a Vertical FDE](https://agentfactory1.panaversity.org/docs/how-to-get-paid-agentic-ai-era) and [Human-Agent Teams](https://agentfactory1.panaversity.org/docs/human-agent-teams-crash-course). The Google Flow and Veo MCP servers were seen only as search listings, such as [this Flow server listing](https://glama.ai/mcp/servers/Sergiorushy326/google-flow-mcp) and [this Veo server](https://github.com/alohc/veo-mcp-server). I did not open or test any of them.

**On the books.** The connector I have reads one book, The AI Agent Factory, whose own pages name agentfactory1.panaversity.org as the canonical address. The page you linked on agentfactory.panaversity.org points to that same address. I found no separate second book through the connector and did not read agentfactory.piaic.org.

Seen only as search results, not opened:

- Paperclip's README, through copies of the [paperclipai/paperclip](https://github.com/paperclipai/paperclip) repository
- [Hermes Agent documentation](https://hermes-agent.nousresearch.com/docs), Nous Research

Written from memory and marked in the text: OpenCode's command-line flags, the OpenAI Agents SDK class names in the runner sketch, Phaser's Tiled loader in version 4, Agent SDK option names, Inngest's TypeScript API, the Claude Code plugin folder layout, CLI flags, and the platform, email and calling rules in section 15.
