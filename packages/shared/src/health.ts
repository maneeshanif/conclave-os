import { z } from 'zod';

export const HealthSchema = z.object({ ok: z.literal(true) });
export type Health = z.infer<typeof HealthSchema>;
