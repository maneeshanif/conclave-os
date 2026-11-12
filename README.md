# Conclave OS starter

Four steps to start building.

1. **Add the spec.** Open the "Conclave AI OS: Full Build Spec" doc, click its name, choose Export, then Markdown. Save the file here as `docs/SPEC.md`.
2. **Fill in the company.** Open `company/COMPANY.md` and `company/goals.yaml` and replace each `TODO`. `company/departments.yaml` lists the eighteen departments and which are switched on.
3. **Check your CLIs.** In a terminal, make sure `claude` runs and is signed in to the account with a paid plan. Install `opencode` as well if you can, and either sign it in with a ChatGPT or GitHub Copilot plan or point it at a local model. Slice 0 tests the second engine with a stand-in when it is missing.
4. **Start.** Run `git init`, open Claude Code in this folder, and paste the kickoff prompt from `docs/BUILD.md`.

What is in this folder:

| File | Purpose |
| --- | --- |
| `CLAUDE.md` | Standing rules Claude Code reads in every session |
| `docs/BUILD.md` | The current slice, its eleven tasks with acceptance tests, and the prompts to paste |
| `docs/DECISIONS.md` | Decisions made so far, and where the open ones are |
| `company/COMPANY.md` | The company as text: offers, markets, voice, rules every agent follows |
| `company/goals.yaml` | The goal ladder |
| `company/departments.yaml` | Department keys, rooms, and which are active |
| `.env.example` | Names of the secrets later slices need. No values |

Build one slice at a time. Do not open slice 1 until slice 0 is something you use.

After exporting the spec, open `docs/SPEC.md` and check that section 2 still makes sense without its diagram. The diagram may not survive the Markdown export.
