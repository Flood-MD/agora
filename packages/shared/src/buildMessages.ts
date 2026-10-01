import { slotDisplayName, type Message, type SessionConfig, type Slot } from './types';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
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
  let label: string;
  if (message.author === 'user') {
    label = isPrivate ? `Private message from ${username}` : username;
  } else {
    const author = config.slots.find((s) => s.id === message.author);
    label = author ? slotDisplayName(author) : message.authorName;
  }
  return { role: 'user', content: `[${label}]: ${message.text}` };
}

function mergeAdjacent(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += `\n\n${t.content}`;
    else out.push({ ...t });
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
  const system = buildSystemPrompt(
    slot,
    config,
    username,
    visible.some((m) => m.audience !== 'all'),
  );
  let turns = visible.map((m) => toTurn(m, slot, config, username));

  let trimmed = false;
  if (input.contextLength) {
    const budget = input.contextLength - (input.reserveForOutput ?? 0) - estimateTokens(system) - 64;
    let total = turns.reduce((n, t) => n + estimateTokens(t.content) + 4, 0);
    // Drop the oldest turns first, but always keep the most recent one.
    while (total > budget && turns.length > 1) {
      total -= estimateTokens(turns[0]!.content) + 4;
      turns = turns.slice(1);
      trimmed = true;
    }
  }

  const messages = mergeAdjacent(turns);
  if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: OPENING_TURN });
  if (messages[messages.length - 1]!.role !== 'user') messages.push({ role: 'user', content: CONTINUE_TURN });
  return { system, messages, trimmed };
}

/** Removes a leading "[Own Name]:" that models sometimes echo back from the transcript format. */
export function cleanReply(text: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`^\\s*\\[${escaped}\\]:\\s*`), '');
}
