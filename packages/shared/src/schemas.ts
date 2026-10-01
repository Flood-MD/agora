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
