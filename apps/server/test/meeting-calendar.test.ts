import { describe, expect, it } from 'vitest';
import { icsText, meetingsToIcs } from '../src/meetings/calendar';

describe('the meetings calendar file', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  const m = { id: '11111111-1111-1111-1111-111111111111', title: 'Kickoff, with Acme; bring plans', startsAt: new Date('2026-11-25T14:30:00Z'), status: 'planned' };

  it('is a calendar with one event for each meeting, with times in UTC and an hour by default', () => {
    const out = meetingsToIcs([m, { ...m, id: '22222222-2222-2222-2222-222222222222', status: 'cancelled' }], now);
    expect(out.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(out.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(out).toContain('DTSTART:20261125T143000Z');
    expect(out).toContain('DTEND:20261125T153000Z');
    expect(out).toContain('DTSTAMP:20261120T100000Z');
    expect(out).toContain('UID:11111111-1111-1111-1111-111111111111@conclave-os');
    expect(out).toContain('STATUS:CONFIRMED');
    expect(out).toContain('STATUS:CANCELLED');
  });

  it('escapes the title so it cannot add a line or a field, and strips control characters', () => {
    expect(icsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const evil = meetingsToIcs([{ ...m, title: 'x\r\nATTENDEE:mailto:evil@example.com\u0007' }], now);
    expect(evil).not.toMatch(/^ATTENDEE:/m);
    expect(evil).toContain('SUMMARY:x\\nATTENDEE:mailto:evil@example.com');
  });

  it('folds long lines at 75 characters and never writes a link, a room or an address', () => {
    const out = meetingsToIcs([{ ...m, title: 'T'.repeat(200) }], now);
    for (const line of out.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75);
    expect(out).not.toMatch(/URL|LOCATION|ATTENDEE|http/i);
  });

  it('is an empty calendar with no meetings', () => {
    expect(meetingsToIcs([], now)).toBe('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Conclave OS//Client meetings//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nEND:VCALENDAR\r\n');
  });
});
