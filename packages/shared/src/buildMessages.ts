import { slotDisplayName, type ContextItem, type Message, type SessionConfig, type Slot } from './types';

export type ContentPart = { type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string };

export interface ChatTurn {
  role: 'user' | 'assistant';
  /** Plain text, or text and images (only the shared-context turn carries images). */
  content: string | ContentPart[];
}

/** Rough token cost of an image, for budgeting only. */
export const IMAGE_TOKENS = 1_500;

export function turnText(content: ChatTurn['content']): string {
  return typeof content === 'string'
    ? content
    : content.map((p) => (p.type === 'text' ? p.text : '[image]')).join('\n\n');
}

function turnTokens(content: ChatTurn['content']): number {
  return typeof content === 'string'
    ? estimateTokens(content)
    : content.reduce((n, p) => n + (p.type === 'text' ? estimateTokens(p.text) : IMAGE_TOKENS), 0);
}

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * The shared-context turn: every attachment, ahead of the conversation. Images go in as images for
 * models that can see them, and as a short note for the rest.
 */
export function contextTurn(items: ContextItem[], username: string, vision: boolean): ChatTurn | undefined {
  if (!items.length) return undefined;
  const parts: ContentPart[] = [
    {
      type: 'text',
      text: `Shared context: material ${username} attached to this chat. Every participant can see it. Refer to it when relevant.`,
    },
  ];
  for (const item of items) {
    const attrs = `title="${escapeAttr(item.title)}" kind="${item.kind}"`;
    if (item.kind === 'image' && item.data && item.mediaType) {
      if (vision) {
        parts.push({ type: 'text', text: `<image ${attrs}>` });
        parts.push({ type: 'image', mediaType: item.mediaType, data: item.data });
      } else {
        parts.push({
          type: 'text',
          text: `<image ${attrs}>(You can't view images; ask the others if it matters.)</image>`,
        });
      }
    } else {
      parts.push({ type: 'text', text: `<document ${attrs}>\n${item.text}\n</document>` });
    }
  }
  // Collapse adjacent text parts so text-only models get one plain string.
  const merged: ContentPart[] = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (p.type === 'text' && last?.type === 'text') last.text += `\n\n${p.text}`;
    else merged.push({ ...p });
  }
  return {
    role: 'user',
    content: merged.length === 1 && merged[0]!.type === 'text' ? merged[0]!.text : merged,
  };
}

export interface BuiltPrompt {
  system: string;
  messages: ChatTurn[];
  /** True when older history was dropped to fit the context window. */
  trimmed: boolean;
}

export interface BuildInput {
  slot: Slot;
  config: SessionConfig;
  /** Transcript so far, in order. Unfinished/errored messages are ignored. */
  history: Message[];
  username: string;
  /** Context window of the slot's model in tokens, if known. */
  contextLength?: number;
  /** Tokens to keep free for the reply. */
  reserveForOutput?: number;
  /** Mode-specific instructions (leader, fusion, self-chat), appended to the system prompt. */
  instructions?: string;
  /** Attachments shared with every model. */
  context?: ContextItem[];
  /** Whether the slot's model accepts images. */
  vision?: boolean;
}

const OPENING_TURN = '(The group chat has just started.)';
const CONTINUE_TURN = '(Continue the conversation.)';

/** Rough, provider-agnostic token estimate (~4 chars per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function isVisibleTo(message: Message, slotId: string): boolean {
  return message.audience === 'all' || message.audience === slotId;
}

function usable(message: Message): boolean {
  return message.status !== 'streaming' && message.status !== 'error' && message.text.trim() !== '';
}

export function buildSystemPrompt(
  slot: Slot,
  config: SessionConfig,
  username: string,
  hasPrivate = false,
): string {
  const name = slotDisplayName(slot);
  const others = config.slots.filter((s) => s.id !== slot.id && s.model).map(slotDisplayName);
  const roster = [
    `You are ${name}, an AI participant in a group chat with a human named ${username}.`,
    others.length
      ? `The other AI participants are: ${others.join(', ')}.`
      : 'You are currently the only AI participant.',
    'Messages from other participants appear as "[Name]: message". Your own earlier messages appear without a prefix.',
    'Reply only as yourself: write your message directly, without a "[Name]:" prefix, and never write lines for other participants.',
  ];
  if (hasPrivate) {
    roster.push(
      `A message marked "[Private message from ${username}]" was sent only to you; the other participants cannot see it or your reply. Do not reveal its content to them unless ${username} asks you to.`,
    );
  }
  return [config.systemPrompt.trim(), slot.prompt?.trim(), roster.join('\n')].filter(Boolean).join('\n\n');
}

function toTurn(message: Message, slot: Slot, config: SessionConfig, username: string): ChatTurn {
  if (message.author === slot.id) return { role: 'assistant', content: message.text };
  const isPrivate = message.audience !== 'all';
  const nameOf = (slotId: string, fallback: string) => {
    const s = config.slots.find((x) => x.id === slotId);
    return s ? slotDisplayName(s) : fallback;
  };
  let label: string;
  if (message.author === 'user') {
    if (isPrivate) label = `Private message from ${username}`;
    else if (message.target) label = `${username}, to ${nameOf(message.target, 'one participant')}`;
    else label = username;
  } else {
    label = nameOf(message.author, message.authorName);
    if (message.kind === 'leader') label += ', as leader';
    if (message.kind === 'fusion') label += ', fusing the answers';
  }
  return { role: 'user', content: `[${label}]: ${message.text}` };
}

function toParts(content: ChatTurn['content']): ContentPart[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content;
}

function mergeAdjacent(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (!last || last.role !== t.role) out.push({ ...t });
    else if (typeof last.content === 'string' && typeof t.content === 'string')
      last.content += `\n\n${t.content}`;
    else last.content = [...toParts(last.content), ...toParts(t.content)];
  }
  return out;
}

/**
 * Builds the request for one slot from the shared transcript.
 * The result always starts and ends with a `user` turn and strictly alternates roles,
 * which satisfies every provider (Anthropic requires it, and rejects assistant prefill).
 */
export function buildMessages(input: BuildInput): BuiltPrompt {
  const { slot, config, history, username } = input;
  const visible = history.filter((m) => usable(m) && isVisibleTo(m, slot.id));
  const system = [
    buildSystemPrompt(
      slot,
      config,
      username,
      visible.some((m) => m.audience !== 'all'),
    ),
    input.instructions?.trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
  let turns = visible.map((m) => toTurn(m, slot, config, username));

  const shared = contextTurn(input.context ?? [], username, input.vision ?? false);

  let trimmed = false;
  if (input.contextLength) {
    const budget =
      input.contextLength -
      (input.reserveForOutput ?? 0) -
      estimateTokens(system) -
      (shared ? turnTokens(shared.content) : 0) -
      64;
    let total = turns.reduce((n, t) => n + turnTokens(t.content) + 4, 0);
    // Drop the oldest turns first, but always keep the most recent one. Attachments are never dropped.
    while (total > budget && turns.length > 1) {
      total -= turnTokens(turns[0]!.content) + 4;
      turns = turns.slice(1);
      trimmed = true;
    }
  }

  const messages = mergeAdjacent(shared ? [shared, ...turns] : turns);
  if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: OPENING_TURN });
  if (messages[messages.length - 1]!.role !== 'user') messages.push({ role: 'user', content: CONTINUE_TURN });
  return { system, messages, trimmed };
}

/** Removes a leading "[Own Name]:" that models sometimes echo back from the transcript format. */
export function cleanReply(text: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`^\\s*\\[${escaped}\\]:\\s*`), '');
}
