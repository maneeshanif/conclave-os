// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunLog } from '../components/RunLog';
import type { StoredEvent } from '../lib/api';

describe('run log (S0-9)', () => {
  it('renders a stored run’s events in order, whatever order they arrive in', () => {
    const events: StoredEvent[] = [
      { id: 3, type: 'tool_result', data: { type: 'tool_result', tool: 'os_get_task', ok: true, summary: 'the task' } },
      { id: 1, type: 'session', data: { type: 'session', sessionId: 'ses_1' } },
      { id: 5, type: 'done', data: { type: 'done', output: 'Five facts.' } },
      { id: 2, type: 'tool_call', data: { type: 'tool_call', tool: 'os_get_task', input: {} } },
      { id: 4, type: 'cost', data: { type: 'cost', usd: 0.0123, tokensIn: 100, tokensOut: 20 } },
    ];
    render(<RunLog run={{ status: 'succeeded', runtime: 'claude-cli', cost_usd: '0.0123', error: null }} events={events} />);
    const rows = within(screen.getByRole('list', { name: 'run log' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'sessionses_1',
      'callsos_get_task {}',
      'resultos_get_task: the task',
      'cost$0.0123 · 100 in · 20 out',
      'doneFive facts.',
    ]);
    expect(screen.getByText('claude-cli')).toBeTruthy();
    expect(screen.getByText('est. $0.0123')).toBeTruthy();
  });

  it('shows a refused tool and an error clearly', () => {
    render(
      <RunLog
        events={[
          { id: 1, type: 'tool_result', data: { type: 'tool_result', tool: 'os_send_email', ok: false, summary: 'Unknown tool' } },
          { id: 2, type: 'error', data: { type: 'error', kind: 'limit', message: 'usage limit reached' } },
        ]}
      />,
    );
    expect(screen.getByText('refused')).toBeTruthy();
    expect(screen.getByText('error: limit')).toBeTruthy();
  });
});
