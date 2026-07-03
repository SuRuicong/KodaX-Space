import { z } from 'zod';

export const repointelStatusItemSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['ok', 'warn', 'blocked']),
  detail: z.string().min(1),
});

export const repointelStatusChannel = {
  name: 'repointel.status',
  direction: 'invoke',
  input: z.object({
    projectRoot: z.string().min(1).max(4096).optional(),
  }),
  output: z.object({
    projectRoot: z.string().min(1).nullable(),
    projectExists: z.boolean(),
    gitRoot: z.string().min(1).nullable(),
    traceSource: z.enum(['session-events']),
    warmSupported: z.boolean(),
    warmReason: z.string().min(1),
    // Repo-intelligence is a licensed capability: true only when a valid, active
    // license is present (isLicenseActive). When false, Space forces repo-intel
    // off and the UI shows a locked/upsell state instead of running it.
    entitled: z.boolean(),
    diagnostics: z.array(repointelStatusItemSchema).min(1),
  }),
} as const;

export type RepointelStatusItemT = z.infer<typeof repointelStatusItemSchema>;
export type RepointelStatusOutput = z.infer<typeof repointelStatusChannel.output>;
