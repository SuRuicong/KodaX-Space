// ask-user IPC channels - FEATURE_032
//
// KodaX exposes two user-interaction surfaces through the same host callback
// lane: guardrail allow/block escalation and the ask_user_question tool. Space
// keeps them on one queue so cancellation, awaiting state, and modal ordering stay
// coherent.

import { z } from 'zod';

/**
 * Sentinel value an ask_user option carries to request "go back" navigation.
 * Single source of truth for Space (main + renderer, which cannot import the
 * ESM-only SDK). Mirrors the SDK's `ASK_USER_BACK_SIGNAL` export
 * (@kodax-ai/kodax/agent); a drift test asserts they stay equal.
 */
export const ASK_USER_BACK_SIGNAL = '__back__';

const reqIdSchema = z.string().min(1);
const sessionIdSchema = z.string().min(1);

const askUserVerdictSchema = z.enum(['allow', 'block']);

// ---- Signals (FEATURE_158 projection) ----
const askUserSignalSchema = z.object({
  type: z.string().min(1).max(64),
  severity: z.enum(['info', 'warning', 'danger']),
  message: z.string().max(512),
});

// ---- Tool call snapshot (RunnerToolCall subset) ----
const askUserToolCallSchema = z.object({
  toolId: z.string().min(1).max(128),
  toolName: z.string().min(1).max(128),
  input: z.record(z.unknown()).optional(),
});

const askUserQuestionOptionSchema = z.object({
  label: z.string().min(1).max(160),
  description: z.string().max(512).optional(),
  value: z.string().min(1).max(512),
});

const selectionBoundSchema = z.number().int().min(0).max(20);
const askUserQuestionAnswerSchema = z.union([
  z.string().max(4096),
  z.array(z.string().max(512)).max(20),
]);

const guardrailRequestSchema = z.object({
  kind: z.literal('guardrail').optional(),
  reqId: reqIdSchema,
  sessionId: sessionIdSchema,
  reason: z.string().min(1).max(2048),
  toolCall: askUserToolCallSchema,
  signals: z.array(askUserSignalSchema).max(20).optional(),
});

const questionRequestSchema = z
  .object({
    kind: z.enum(['select', 'input']),
    reqId: reqIdSchema,
    sessionId: sessionIdSchema,
    question: z.string().min(1).max(2048),
    header: z.string().min(1).max(96).optional(),
    options: z.array(askUserQuestionOptionSchema).max(20).optional(),
    multiSelect: z.boolean().optional(),
    minSelections: selectionBoundSchema.optional(),
    maxSelections: selectionBoundSchema.optional(),
    default: z.string().max(4096).optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.kind === 'select' && (!payload.options || payload.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'select askUser requests require at least one option',
        path: ['options'],
      });
    }
    if (
      payload.minSelections !== undefined &&
      payload.maxSelections !== undefined &&
      payload.minSelections > payload.maxSelections
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'minSelections cannot exceed maxSelections',
        path: ['maxSelections'],
      });
    }
  });

// ---- Push: askUser.request ---- (main -> renderer)
export const askUserRequestChannel = {
  name: 'askUser.request',
  direction: 'push',
  payload: z.union([guardrailRequestSchema, questionRequestSchema]),
} as const;

const guardrailReplySchema = z.object({
  reqId: reqIdSchema,
  verdict: askUserVerdictSchema,
});

const valueReplySchema = z.object({
  reqId: reqIdSchema,
  value: askUserQuestionAnswerSchema,
});

const cancelReplySchema = z.object({
  reqId: reqIdSchema,
  cancelled: z.literal(true),
});

// ---- Invoke: askUser.reply ---- (renderer -> main)
export const askUserReplyChannel = {
  name: 'askUser.reply',
  direction: 'invoke',
  input: z.union([guardrailReplySchema, valueReplySchema, cancelReplySchema]),
  output: z.object({
    ok: z.boolean(),
  }),
} as const;

// ---- Push: askUser.cancelled ---- (main -> renderer)
export const askUserCancelledChannel = {
  name: 'askUser.cancelled',
  direction: 'push',
  payload: z.object({
    reqId: reqIdSchema,
    sessionId: sessionIdSchema,
    reason: z.enum(['session_cancelled', 'session_disposed', 'shutdown', 'timeout']),
  }),
} as const;

export type AskUserVerdict = z.infer<typeof askUserVerdictSchema>;
export type AskUserSignal = z.infer<typeof askUserSignalSchema>;
export type AskUserToolCall = z.infer<typeof askUserToolCallSchema>;
export type AskUserQuestionOption = z.infer<typeof askUserQuestionOptionSchema>;
export type AskUserQuestionAnswer = z.infer<typeof askUserQuestionAnswerSchema>;
export type AskUserReplyInput = z.infer<typeof askUserReplyChannel.input>;
export type AskUserRequestPayload = z.infer<typeof askUserRequestChannel.payload>;
