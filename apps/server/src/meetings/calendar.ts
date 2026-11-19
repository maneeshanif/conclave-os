/**
 * A calendar file of the client meetings (iCalendar), so they can be put in any calendar app. Pure. It carries the title, the time and
 * the state only: never a guest link, a room name or a client's address, because a calendar file gets copied around.
 */
export interface CalendarMeeting {
  id: string;
  title: string;
  startsAt: Date;
  status: string;
}

/** Text in a calendar file: backslash, semicolon, comma and line breaks are escaped, and no control character gets through. */
export function icsText(s: string): string {
  // Control characters are dropped; line breaks are kept so they can become the two characters \n below.
  const clean = [...s].filter((ch) => {
    const code = ch.charCodeAt(0);
    return ch === '\n' || ch === '\r' || (code >= 32 && code !== 127);
  });
  return clean
    .join('')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Lines are folded at 75 characters, the way the format asks (a continuation line starts with one space). */
function fold(line: string): string[] {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    out.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  out.push(rest);
  return out;
}

export function meetingsToIcs(meetings: CalendarMeeting[], now: Date = new Date(), minutes = 60): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Conclave OS//Client meetings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const m of meetings) {
    const end = new Date(m.startsAt.getTime() + minutes * 60_000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${m.id}@conclave-os`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(m.startsAt)}`,
      `DTEND:${stamp(end)}`,
      ...fold(`SUMMARY:${icsText(m.title)}`),
      `STATUS:${m.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
