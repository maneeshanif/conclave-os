import { Hono } from 'hono';
import { HealthSchema } from '@conclave/shared';

export const app = new Hono();

app.get('/health', (c) => c.json(HealthSchema.parse({ ok: true })));
