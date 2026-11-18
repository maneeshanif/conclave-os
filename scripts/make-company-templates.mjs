// Makes the SaaS founder and course creator company templates from the starter (S9-5). Run: node scripts/make-company-templates.mjs
// Same map and department keys as the starter; the names, the company text and the goals are the new company's own.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const starter = path.join(root, 'templates', 'companies', 'starter');

const TEMPLATES = {
  'saas-founder': {
    names: { 'chief-of-staff': 'Chief of Staff', 'lead-gen': 'Growth', outreach: 'Onboarding Outreach', research: 'Product Research' },
    company: `# {{company_name}}

Every agent reads this file. Keep it short and true. Fill in each \`TODO\`.

## What we do

TODO: the product, in one sentence, and the problem it removes for a small team.

## Who we sell to

TODO: the kind of team that signs up (size, role, tools they already use), and where they gather online.

## How we talk

TODO: three words for the tone (for example: clear, practical, friendly). What we never promise.

## Plans and prices

TODO: the plans and what each costs. Agents may quote only what is written here.

## Contact and sender

- Sender name: TODO
- Postal address for email footers: TODO
`,
    goals: `# The goal ladder for a software product. Example numbers: set your own.
north_star: monthly recurring revenue from teams that keep using the product

ladder:
  - id: rung-1
    target_usd: 1000
    by: null
    source: subscriptions

current_rung: rung-1

department_goals:
  lead-gen: { metric: trial_signups_per_week,       target: 15, serves: rung-1 }
  outreach: { metric: activated_trials_per_week,    target: 5,  serves: rung-1 }
`,
  },
  'course-creator': {
    names: { 'chief-of-staff': 'Chief of Staff', 'lead-gen': 'Audience', outreach: 'Admissions', research: 'Curriculum Research' },
    company: `# {{company_name}}

Every agent reads this file. Keep it short and true. Fill in each \`TODO\`.

## What we teach

TODO: the subject, who it is for, and what a student can do at the end that they could not before.

## Who our students are

TODO: who joins (their job, their level, what they have tried), and where they spend time online.

## How we talk

TODO: three words for the tone (for example: encouraging, plain, honest). What we never promise about results.

## Courses and prices

TODO: each course, its price and what is included. Agents may quote only what is written here.

## Contact and sender

- Teacher name: TODO
- Postal address for email footers: TODO
`,
    goals: `# The goal ladder for a course business. Example numbers: set your own.
north_star: students who finish a course and would recommend it

ladder:
  - id: rung-1
    target_usd: 1000
    by: null
    source: course sales

current_rung: rung-1

department_goals:
  lead-gen: { metric: new_subscribers_per_week,   target: 40, serves: rung-1 }
  outreach: { metric: enrolments_per_week,        target: 3,  serves: rung-1 }
`,
  },
};

const map = JSON.parse(readFileSync(path.join(starter, 'office.tmj'), 'utf8'));
const dept = (r) => r.properties?.find((p) => p.name === 'department')?.value;

for (const [name, t] of Object.entries(TEMPLATES)) {
  const out = path.join(root, 'templates', 'companies', name);
  if (existsSync(out)) throw new Error(`${out} exists; delete it first to rebuild.`);
  mkdirSync(out, { recursive: true });
  const m = JSON.parse(JSON.stringify(map));
  const rename = new Map();
  for (const l of m.layers) for (const r of l.name === 'rooms' ? (l.objects ?? []) : []) if (dept(r) && t.names[dept(r)] && t.names[dept(r)] !== r.name) rename.set(r.name, t.names[dept(r)]);
  for (const l of m.layers) {
    for (const o of l.objects ?? []) {
      for (const [from, to] of rename) {
        if (o.name === from) o.name = to;
        else if (o.name?.startsWith(`${from} `)) o.name = `${to}${o.name.slice(from.length)}`;
        for (const p of o.properties ?? []) if (p.name === 'room' && p.value === from) p.value = to;
      }
    }
  }
  writeFileSync(path.join(out, 'office.tmj'), JSON.stringify(m, null, 1) + '\n');
  writeFileSync(path.join(out, 'COMPANY.md'), t.company);
  writeFileSync(path.join(out, 'goals.yaml'), t.goals);
  const lines = readFileSync(path.join(starter, 'departments.yaml'), 'utf8').split('\n').map((l) => {
    const k = /key:\s*([a-z0-9-]+)/.exec(l)?.[1];
    return k && t.names[k] ? l.replace(/name:\s*[^,]+,/, `name: ${t.names[k]},`) : l;
  });
  writeFileSync(path.join(out, 'departments.yaml'), lines.join('\n'));
  writeFileSync(path.join(out, 'README.md'), `# ${name}\n\nA company template. Make a company from it in the office (Companies), then fill in each TODO in COMPANY.md and goals.yaml. It has the same four rooms as the starter with names that fit this kind of business.\n`);
  process.stdout.write(`wrote ${out}\n`);
}
void cpSync;
