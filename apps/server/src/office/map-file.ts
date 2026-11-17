import { rename, writeFile } from 'node:fs/promises';

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
