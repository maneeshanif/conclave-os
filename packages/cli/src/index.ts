import { parseArgs } from 'node:util';
import { agentNew, renderAll } from '@conclave/server/commands/agent-new';
import { RUNTIMES, type RuntimeName } from '@conclave/server/runtimes/names';
import { openSystem } from '@conclave/server/system';

const usage = `Usage:
  pnpm db:migrate
  pnpm agent:new <template> --department <key> [--id <id>] [--name <name>] [--runtime <runtime>] [--model <alias>] [--autonomy <0-3>] [--reports-to <id>]
  pnpm agent:render          render every agent's working folder again from its role file
  pnpm run doctor           (plain 'pnpm doctor' runs pnpm's own doctor)
  pnpm run eval:gate -- --drafts <file.json> | --reference   score drafts against the stored baseline; fails if worse
  pnpm run eval:baseline -- --drafts <file.json> | --reference   store a new baseline
  pnpm run e2e              slice 0 end to end on both engines, against a running server`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'agent:new': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          department: { type: 'string' },
          id: { type: 'string' },
          name: { type: 'string' },
          runtime: { type: 'string' },
          model: { type: 'string' },
          autonomy: { type: 'string' },
          'reports-to': { type: 'string' },
        },
      });
      const template = positionals[0];
      if (!template || !values.department) {
        console.error(usage);
        return 2;
      }
      if (values.runtime && !(RUNTIMES as readonly string[]).includes(values.runtime)) {
        console.error(`Unknown runtime "${values.runtime}". Use one of: ${RUNTIMES.join(', ')}`);
        return 2;
      }
      if (values.autonomy !== undefined && !/^[0-3]$/.test(values.autonomy)) {
        console.error(`--autonomy must be 0, 1, 2 or 3 (got "${values.autonomy}"). See SPEC 6.`);
        return 2;
      }
      const sys = await openSystem();
      try {
        const r = await agentNew(sys, {
          template,
          department: values.department,
          ...(values.id ? { id: values.id } : {}),
          ...(values.name ? { name: values.name } : {}),
          ...(values.runtime ? { runtime: values.runtime as RuntimeName } : {}),
          ...(values.model ? { model: values.model } : {}),
          ...(values.autonomy !== undefined ? { autonomy: Number(values.autonomy) } : {}),
          ...(values['reports-to'] ? { reportsTo: values['reports-to'] } : {}),
        });
        console.log(`Hired ${r.id} on ${r.runtime} at autonomy ${r.autonomy}.\n  role file:      company/${r.rolePath}\n  working folder: ${r.workDir}`);
      } finally {
        await sys.close();
      }
      return 0;
    }
    case 'agent:render': {
      const sys = await openSystem();
      try {
        for (const r of await renderAll(sys)) console.log(`${r.id}: ${r.runtime} -> ${r.workDir}`);
      } finally {
        await sys.close();
      }
      return 0;
    }
    case 'e2e': {
      const { e2e } = await import('@conclave/server/commands/e2e');
      return e2e();
    }
    case 'eval:gate':
    case 'eval:baseline': {
      const { evalCommand } = await import('@conclave/server/commands/eval');
      return evalCommand(command === 'eval:gate' ? 'gate' : 'baseline', rest);
    }
    case 'doctor': {
      const { doctor } = await import('@conclave/server/commands/doctor');
      return doctor();
    }
    default:
      console.error(usage);
      return command ? 2 : 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  },
);
