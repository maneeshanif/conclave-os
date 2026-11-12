import { parseArgs } from 'node:util';
import { agentNew, renderAll } from '@conclave/server/commands/agent-new';
import { RUNTIMES, type RuntimeName } from '@conclave/server/runtimes/names';
import { openSystem } from '@conclave/server/system';

const usage = `Usage:
  pnpm db:migrate
  pnpm agent:new <template> --department <key> [--id <id>] [--name <name>] [--runtime <runtime>] [--model <alias>] [--reports-to <id>]
  pnpm agent:render          render every agent's working folder again from its role file
  pnpm doctor`;

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
      const sys = await openSystem();
      try {
        const r = await agentNew(sys, {
          template,
          department: values.department,
          ...(values.id ? { id: values.id } : {}),
          ...(values.name ? { name: values.name } : {}),
          ...(values.runtime ? { runtime: values.runtime as RuntimeName } : {}),
          ...(values.model ? { model: values.model } : {}),
          ...(values['reports-to'] ? { reportsTo: values['reports-to'] } : {}),
        });
        console.log(`Hired ${r.id} on ${r.runtime} at autonomy 0.\n  role file:      company/${r.rolePath}\n  working folder: ${r.workDir}`);
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
