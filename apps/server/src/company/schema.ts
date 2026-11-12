import { z } from 'zod';
import { RUNTIMES } from '../runtimes/names';

const key = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'use lowercase letters, digits and dashes');

export const DepartmentSchema = z.object({
  key,
  name: z.string().min(1),
  room: z.number().int().min(0),
  active: z.boolean(),
  division: z.string().optional(),
});
export const DepartmentsFileSchema = z.object({ departments: z.array(DepartmentSchema).min(1) });
export type Department = z.infer<typeof DepartmentSchema>;

export const RungSchema = z.object({
  id: key,
  target_usd: z.number().positive(),
  by: z.union([z.string(), z.date(), z.null()]).optional(),
  source: z.string().optional(),
});
export const GoalsFileSchema = z.object({
  north_star: z.string().optional(),
  ladder: z.array(RungSchema).min(1),
  current_rung: key,
  planning_rates: z.record(z.string(), z.number().nullable()).optional(),
  department_goals: z
    .record(key, z.object({ metric: z.string().min(1), serves: key }))
    .optional()
    .default({}),
});
export type GoalsFile = z.infer<typeof GoalsFileSchema>;

/** Front matter of a role file (SPEC 5). The role file is the source of truth for these fields. */
export const RoleFileSchema = z
  .object({
    id: key,
    name: z.string().min(1),
    department: key,
    reports_to: key.nullable().optional(),
    runtime: z.enum(RUNTIMES, {
      error: (issue) => `unknown runtime "${String(issue.input)}". Use one of: ${RUNTIMES.join(', ')}`,
    }),
    model: z.string().min(1),
    fallback_model: z.string().optional(),
    heartbeat: z.string().optional(),
    monthly_budget_usd: z.number().nonnegative().default(5),
    autonomy: z.number().int().min(0).max(3).default(0),
    template: z.string().optional(),
    template_version: z.number().int().positive().optional(),
    plugins: z.array(z.string()).default([]),
    skills: z.array(z.string()).default([]),
    connectors: z.array(z.string()).default([]),
    max_turns: z.number().int().positive().default(25),
    output_check: z.string().optional(),
  })
  .strict();
export type RoleFile = z.infer<typeof RoleFileSchema>;
