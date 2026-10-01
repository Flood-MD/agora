import { z } from 'zod';
import { MAX_SLOTS, PROVIDER_IDS } from './types';

export const slotSchema = z.object({
  id: z.string().min(1).max(64),
  model: z.string().max(300).nullable(),
  modelLabel: z.string().max(300),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  customName: z.string().max(100).optional(),
  prompt: z.string().max(20_000).optional(),
});

export const sessionConfigSchema = z.object({
  slots: z.array(slotSchema).max(MAX_SLOTS),
  systemPrompt: z.string().max(50_000),
  showModelNames: z.boolean(),
  leader: z.boolean().optional(),
  leaderSlotId: z.string().max(64).optional(),
  fusion: z.boolean().optional(),
});

export const createSessionSchema = z.object({
  title: z.string().max(200).optional(),
  config: sessionConfigSchema.optional(),
});

export const updateSessionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  config: sessionConfigSchema.optional(),
  /** Optimistic concurrency: the `updatedAt` the client last saw. */
  baseUpdatedAt: z.number().optional(),
});

export const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(200_000),
  /** Send to one slot only. */
  target: z.string().min(1).max(64).optional(),
  /** With a target: hide the message and the reply from the other models. */
  private: z.boolean().optional(),
});

export const MAX_SELF_CHAT_ROUNDS = 20;

export const selfChatSchema = z.object({
  rounds: z.number().int().min(1).max(MAX_SELF_CHAT_ROUNDS),
  /** Optional opening message from the user. */
  topic: z.string().trim().max(200_000).optional(),
});

const keySchema = z.string().trim().max(500).nullable().optional();

export const updateSettingsSchema = z.object({
  username: z.string().trim().min(1).max(60).optional(),
  customBaseUrl: z.union([z.literal(''), z.url().max(500)]).optional(),
  keys: z
    .object({
      openai: keySchema,
      anthropic: keySchema,
      openrouter: keySchema,
      huggingface: keySchema,
      custom: keySchema,
    })
    .partial()
    .optional(),
});

export const EXPORT_FORMAT = 'agora.session';

const exportedMessageSchema = z.object({
  round: z.number().int().min(0),
  author: z.string().min(1).max(64),
  authorName: z.string().max(200),
  model: z.string().max(300).optional(),
  text: z.string().max(500_000),
  status: z.enum(['streaming', 'done', 'error', 'stopped', 'interrupted']),
  error: z.string().max(5_000).optional(),
  audience: z.string().min(1).max(64),
  target: z.string().max(64).optional(),
  kind: z.enum(['leader', 'fusion', 'self-chat']).optional(),
  usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() }).optional(),
  latencyMs: z.number().optional(),
  createdAt: z.number(),
});

/** The file written by Save and read by Load. */
export const sessionExportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(1),
  exportedAt: z.number(),
  title: z.string().trim().min(1).max(200),
  config: sessionConfigSchema,
  messages: z.array(exportedMessageSchema).max(20_000),
});

export type SessionExport = z.infer<typeof sessionExportSchema>;
export type ExportedMessage = z.infer<typeof exportedMessageSchema>;

/** A model id typed in by hand, for models a provider serves but doesn't list (yet). */
export const customModelSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().trim().min(1).max(300).regex(/^\S+$/, 'Model IDs cannot contain spaces'),
  name: z.string().trim().max(100).optional(),
  contextLength: z.number().int().positive().max(100_000_000).optional(),
});

export type CustomModelInput = z.infer<typeof customModelSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
