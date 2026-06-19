import { z } from 'zod';

export const handoffStatusSchema = z.enum(['valid', 'invalid', 'stale']);

export const handoffFileSchema = z.object({
  id: z.string().min(1),
  filePath: z.string().min(1),
  status: handoffStatusSchema,
  sessionId: z.string().min(1).nullable(),
  projectRoot: z.string().min(1).nullable(),
  source: z.string().min(1).nullable(),
  createdAt: z.number().int().nonnegative().nullable(),
  error: z.string().min(1).optional(),
});

export const handoffListChannel = {
  name: 'handoff.list',
  direction: 'invoke',
  input: z.undefined(),
  output: z.object({
    handoffs: z.array(handoffFileSchema),
  }),
} as const;

export const handoffAcceptChannel = {
  name: 'handoff.accept',
  direction: 'invoke',
  input: z.object({
    handoffId: z.string().min(1),
    expectedSessionId: z.string().min(1).optional(),
  }),
  output: z.object({
    accepted: z.boolean(),
    removed: z.boolean(),
    sessionId: z.string().min(1).optional(),
    projectRoot: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
  }),
} as const;

export const handoffDismissChannel = {
  name: 'handoff.dismiss',
  direction: 'invoke',
  input: z.object({
    handoffId: z.string().min(1),
  }),
  output: z.object({
    dismissed: z.boolean(),
    removed: z.boolean(),
    error: z.string().min(1).optional(),
  }),
} as const;

export const handoffChangedChannel = {
  name: 'handoff.changed',
  direction: 'push',
  payload: z.object({
    handoffs: z.array(handoffFileSchema),
  }),
} as const;

export type HandoffFileT = z.infer<typeof handoffFileSchema>;
export type HandoffStatusT = z.infer<typeof handoffStatusSchema>;
