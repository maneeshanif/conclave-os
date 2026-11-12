import { cn } from '../../lib/cn';

const tones: Record<string, string> = {
  todo: 'bg-neutral-100 text-neutral-700',
  in_progress: 'bg-blue-100 text-blue-800',
  running: 'bg-blue-100 text-blue-800',
  waiting_approval: 'bg-amber-100 text-amber-800',
  blocked: 'bg-amber-100 text-amber-800',
  done: 'bg-green-100 text-green-800',
  succeeded: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  timed_out: 'bg-red-100 text-red-800',
  cancelled: 'bg-neutral-100 text-neutral-500',
};

export function Badge({ value }: { value: string }) {
  return <span className={cn('inline-flex rounded px-1.5 py-0.5 text-xs font-medium', tones[value] ?? 'bg-neutral-100 text-neutral-700')}>{value.replace('_', ' ')}</span>;
}
