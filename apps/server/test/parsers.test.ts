import { describe, expect, it } from 'vitest';
import { claudeParser } from '../src/runtimes/parsers';

const assistant = (message: Record<string, unknown>) => JSON.stringify({ type: 'assistant', message });

describe('counting Claude turns (S0-13)', () => {
  it('counts one turn for one message streamed as several events', () => {
    const p = claudeParser();
    // Claude Code streams one model message as one event per content block, all with the same message.id.
    p.line(assistant({ id: 'msg_1', content: [{ type: 'text', text: 'Let me look.' }] }));
    p.line(assistant({ id: 'msg_1', content: [{ type: 'tool_use', id: 'a', name: 'get_task', input: {} }] }));
    p.line(assistant({ id: 'msg_1', content: [{ type: 'tool_use', id: 'b', name: 'get_lead', input: {} }] }));
    expect(p.turns()).toBe(1);
  });

  it('counts each new message id as a new turn', () => {
    const p = claudeParser();
    p.line(assistant({ id: 'msg_1', content: [{ type: 'text', text: 'one' }] }));
    p.line(assistant({ id: 'msg_1', content: [{ type: 'text', text: 'still one' }] }));
    p.line(assistant({ id: 'msg_2', content: [{ type: 'text', text: 'two' }] }));
    p.line(assistant({ id: 'msg_3', content: [{ type: 'text', text: 'three' }] }));
    expect(p.turns()).toBe(3);
  });

  it('counts an event with no message id as its own turn, so a stream that omits ids still hits the limit', () => {
    const p = claudeParser();
    p.line(assistant({ content: [{ type: 'text', text: 'a' }] }));
    p.line(assistant({ content: [{ type: 'text', text: 'b' }] }));
    expect(p.turns()).toBe(2);
  });

  it('ignores events that are not assistant messages', () => {
    const p = claudeParser();
    p.line(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }));
    p.line(JSON.stringify({ type: 'user', message: { content: [] } }));
    p.line('not json at all');
    expect(p.turns()).toBe(0);
  });

  it('still turns every content block into its event', () => {
    const p = claudeParser();
    const events = [
      ...p.line(assistant({ id: 'msg_1', content: [{ type: 'text', text: 'hello' }] })),
      ...p.line(assistant({ id: 'msg_1', content: [{ type: 'tool_use', id: 'a', name: 'get_task', input: {} }] })),
    ];
    expect(events.map((e) => e.type)).toEqual(['message', 'tool_call']);
  });
});
