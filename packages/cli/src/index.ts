// Stubs. Each command is built in the task named here, not before.
const planned: Record<string, string> = {
  'db:migrate': 'S0-2',
  'agent:new': 'S0-4',
  doctor: 'S0-10',
};

const command = process.argv[2] ?? '';
const task = planned[command];

if (task) {
  console.error(`${command}: not yet implemented (planned for ${task}).`);
} else {
  console.error(`Usage: conclave <${Object.keys(planned).join('|')}>`);
}
process.exit(1);
