export const PROVIDER_IDS = ['openai', 'anthropic', 'openrouter', 'huggingface', 'custom', 'mock'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  huggingface: 'Hugging Face',
  custom: 'Custom endpoint',
  mock: 'Mock (offline)',
};

export interface ModelInfo {
  /** Namespaced id: `<provider>/<provider model id>`, e.g. `openrouter/google/gemini-2.5-flash`. */
  id: string;
  provider: ProviderId;
  name: string;
  contextLength?: number;
  maxOutput?: number;
  vision?: boolean;
  /** USD per 1M tokens, when the provider publishes it. */
  pricing?: { prompt: number; completion: number };
  /** Added by hand (Model picker ▸ Add by ID) rather than listed by the provider. */
  custom?: boolean;
}

export interface Slot {
  id: string;
  /** Namespaced model id, or null for an empty slot. */
  model: string | null;
  /** Display name of the model, captured when it was picked. */
  modelLabel: string;
  color: string;
  /** Custom display name (Roles ▸ Custom Names). */
  customName?: string;
  /** Slot-specific prompt (Roles ▸ Slot Prompts). */
  prompt?: string;
}

export interface SessionConfig {
  slots: Slot[];
  systemPrompt: string;
  showModelNames: boolean;
  /** Leader mode: the other models answer first, then the leader gives the final answer. */
  leader?: boolean;
  /** Which slot leads; falls back to the first slot with a model. */
  leaderSlotId?: string;
  /** Fusion mode: after everyone answers, slot 1's model merges the answers into one. */
  fusion?: boolean;
  /** Let models search the web (OpenRouter, Anthropic and OpenAI only). */
  webSearch?: boolean;
}

export const CONTEXT_KINDS = ['file', 'folder', 'image', 'github', 'youtube', 'transcript'] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

/** Material attached to a chat (Attach menu). Every model sees it, ahead of the conversation. */
export interface ContextItem {
  id: string;
  sessionId: string;
  kind: ContextKind;
  title: string;
  /** Extracted text (empty for images). */
  text: string;
  /** For images: media type and base64 data. */
  mediaType?: string;
  data?: string;
  /** Rough token count. */
  tokens: number;
  /** e.g. "34 files, 6 skipped" for a folder or repository. */
  note?: string;
  createdAt: number;
}

export interface Session {
  id: string;
  title: string;
  config: SessionConfig;
  createdAt: number;
  updatedAt: number;
  running: boolean;
  /** True when a cleared transcript can be brought back with Restore. */
  canRestore: boolean;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  running: boolean;
  messageCount: number;
  /** When listing with a search query: a snippet of the matching message text. */
  match?: string;
}

export type MessageStatus = 'streaming' | 'done' | 'error' | 'stopped' | 'interrupted';

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface Message {
  id: string;
  sessionId: string;
  /** Monotonic order within the session. */
  seq: number;
  round: number;
  /** `'user'` or the slot id that produced the message. */
  author: string;
  /** Name shown for the author when the message was created (kept if the slot is later removed). */
  authorName: string;
  model?: string;
  text: string;
  status: MessageStatus;
  error?: string;
  /** `'all'`, or a slot id for a private message visible only to that slot. */
  audience: string;
  /** On a user message sent to one model only (visible or private): that slot's id. */
  target?: string;
  /** How a model reply was produced, when not a plain answer. */
  kind?: MessageKind;
  usage?: Usage;
  latencyMs?: number;
  createdAt: number;
}

export type MessageKind = 'leader' | 'fusion' | 'self-chat';

export interface SessionDetail {
  session: Session;
  messages: Message[];
  context: ContextItem[];
}

export type SessionEvent =
  | { type: 'message'; message: Message }
  | { type: 'session'; session: Session }
  | { type: 'snapshot'; detail: SessionDetail }
  | { type: 'deleted'; sessionId: string }
  | { type: 'context'; sessionId: string; items: ContextItem[] };

export interface ProviderStatus {
  configured: boolean;
  /** Where the active key comes from. Env always wins over a key saved in the app. */
  source: 'env' | 'app' | null;
  /** Masked key, e.g. `sk-…a1b2`. Never the real key. */
  hint: string | null;
}

export interface SettingsView {
  username: string;
  customBaseUrl: string;
  providers: Record<Exclude<ProviderId, 'mock'>, ProviderStatus>;
  /** Optional GitHub token for private repositories and higher rate limits. */
  github: ProviderStatus;
  /** Whether audio can be transcribed (needs an OpenAI or Hugging Face key). */
  transcription: boolean;
  mockEnabled: boolean;
}

export const SLOT_COLORS = [
  '#3b82f6', // blue
  '#ea580c', // orange
  '#eab308', // amber
  '#16a34a', // green
  '#9333ea', // purple
  '#db2777', // pink
  '#0d9488', // teal
  '#64748b', // slate
] as const;

export const MAX_SLOTS = SLOT_COLORS.length;

export function slotDisplayName(slot: Slot): string {
  return slot.customName?.trim() || slot.modelLabel || 'Empty slot';
}

export function nextSlotColor(slots: Slot[]): string {
  const used = new Set(slots.map((s) => s.color));
  return SLOT_COLORS.find((c) => !used.has(c)) ?? SLOT_COLORS[slots.length % SLOT_COLORS.length]!;
}

export function splitModelId(id: string): { provider: ProviderId; model: string } {
  const i = id.indexOf('/');
  const provider = id.slice(0, i) as ProviderId;
  if (i < 0 || !PROVIDER_IDS.includes(provider)) throw new Error(`Invalid model id: ${id}`);
  return { provider, model: id.slice(i + 1) };
}
