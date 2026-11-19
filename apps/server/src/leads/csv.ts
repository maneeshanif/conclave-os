/**
 * A small CSV reader (RFC 4180): commas, quoted fields with doubled quotes, line breaks inside quotes, Windows or Unix
 * line endings, and a leading byte-order mark. Returns the records, each a list of cells. Blank lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let sawAnything = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
      sawAnything = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
      sawAnything = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      if (sawAnything || cell !== '') {
        row.push(cell);
        rows.push(row);
      }
      row = [];
      cell = '';
      sawAnything = false;
    } else {
      cell += ch;
      sawAnything = true;
    }
  }
  if (sawAnything || cell !== '') {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** The columns a lead import understands, and the header spellings that mean them. */
export const COLUMN_ALIASES: Record<'business_name' | 'website' | 'email' | 'contact_name' | 'notes' | 'source_url', string[]> = {
  business_name: ['businessname', 'business', 'name', 'company', 'companyname'],
  website: ['website', 'web', 'url', 'site'],
  email: ['email', 'emailaddress', 'mail'],
  contact_name: ['contactname', 'contact', 'person', 'owner'],
  notes: ['notes', 'note', 'comments'],
  source_url: ['sourceurl', 'source', 'sourcelink'],
};

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Maps each header to a known column, and lists the headers that mean nothing to the import. */
export function mapHeaders(headers: string[]): { columns: Map<number, keyof typeof COLUMN_ALIASES>; ignored: string[] } {
  const columns = new Map<number, keyof typeof COLUMN_ALIASES>();
  const used = new Set<string>();
  const ignored: string[] = [];
  headers.forEach((h, i) => {
    const k = key(h);
    const hit = (Object.entries(COLUMN_ALIASES) as [keyof typeof COLUMN_ALIASES, string[]][]).find(([, names]) => names.includes(k));
    if (hit && !used.has(hit[0])) {
      columns.set(i, hit[0]);
      used.add(hit[0]);
    } else if (h.trim() !== '') ignored.push(h.trim());
  });
  return { columns, ignored };
}
