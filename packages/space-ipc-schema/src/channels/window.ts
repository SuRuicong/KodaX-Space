import { z } from 'zod';

export const windowActivityStateSchema = z.enum(['active', 'passive', 'hidden']);

export const windowActivityChannel = {
  name: 'window.activity',
  direction: 'push',
  payload: z.object({
    state: windowActivityStateSchema,
    active: z.boolean(),
    focused: z.boolean(),
    visible: z.boolean(),
    minimized: z.boolean(),
  }),
} as const;

export type WindowActivityStateT = z.infer<typeof windowActivityStateSchema>;
export type WindowActivityPayload = z.infer<typeof windowActivityChannel.payload>;
