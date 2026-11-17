import { readFile, rename, writeFile } from 'node:fs/promises';

/** One change to a company's map at a time: two at once would both start from the same file and one would be lost. */
const locks = new Map<string, Promise<unknown>>();
export const exclusive = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const next = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
  locks.set(key, next.catch(() => undefined));
  return next;
};

/** Writes a file so a reader never sees half of it: to a temporary name first, then moved into place. */
export const replaceFile = async (file: string, text: string): Promise<void> => {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
};

/**
 * The last twenty states of a map before an edit, newest last, so an edit can be undone (S6C-2). Kept in memory: a restart starts a
 * fresh history, and the map file itself is always the truth.
 */
const history = new Map<string, string[]>();
const KEEP = 20;

/** Writes the map after an edit and remembers what it was before. */
export async function writeMap(file: string, text: string): Promise<void> {
  const before = await readFile(file, 'utf8').catch(() => null);
  if (before !== null && before !== text) history.set(file, [...(history.get(file) ?? []), before].slice(-KEEP));
  await replaceFile(file, text);
}

/** Puts the map back as it was before the last edit. False if there is nothing to undo. */
export async function undoMap(file: string): Promise<boolean> {
  const list = history.get(file) ?? [];
  const last = list.pop();
  if (last === undefined) return false;
  history.set(file, list);
  await replaceFile(file, last);
  return true;
}
