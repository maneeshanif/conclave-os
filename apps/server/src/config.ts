import { z } from 'zod';

/** The server answers on loopback only. No login exists before slice 1 (CLAUDE.md rule 9). */
export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 3100;

const PortSchema = z.coerce.number().int().min(1).max(65535);

export function resolvePort(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PORT;
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  return PortSchema.parse(raw);
}
