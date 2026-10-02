import { setTimeout as sleep } from 'node:timers/promises';
import { turnText, type ModelInfo } from '@agora/shared';
import { ProviderError, type ChatEvent, type ChatRequest, type Provider } from './types';

const MODELS: ModelInfo[] = [
  { id: 'mock/echo', provider: 'mock', name: 'Mock Echo', contextLength: 32_000 },
  { id: 'mock/chatty', provider: 'mock', name: 'Mock Chatty', contextLength: 32_000 },
  { id: 'mock/slow', provider: 'mock', name: 'Mock Slow', contextLength: 32_000 },
  { id: 'mock/error', provider: 'mock', name: 'Mock Error', contextLength: 32_000 },
  { id: 'mock/vision', provider: 'mock', name: 'Mock Vision', contextLength: 32_000, vision: true },
];

const FILLER =
  'This reply comes from the offline mock provider, which streams canned text so the interface can be tried without any API keys.';

/** Offline provider that streams canned text. Enabled with MOCK_PROVIDER=1. */
export class MockProvider implements Provider {
  readonly id = 'mock' as const;
  constructor(private delayMs: number) {}

  async listModels(): Promise<ModelInfo[]> {
    return MODELS;
  }

  async *stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    if (req.model === 'error') throw new ProviderError('Mock provider error (as requested).');
    // Rapid Roleplay: answer with a deterministic cast of the requested size.
    if (req.system.startsWith('You design roleplay casts')) {
      const ask = turnText(req.messages[0]?.content ?? '');
      const count = Number(ask.match(/exactly (\d+) character/)?.[1] ?? 3);
      const topic = ask.match(/^Scenario: (.*)$/m)?.[1] ?? 'a scene';
      const cast = {
        setting: `Mock setting for: ${topic}`,
        characters: Array.from({ length: count }, (_, i) => ({
          name: `Character ${i + 1}`,
          prompt: `You are character ${i + 1} in ${topic}.`,
        })),
      };
      yield { type: 'text', text: `Here you go:\n\`\`\`json\n${JSON.stringify(cast)}\n\`\`\`` };
      return;
    }
    const name = req.system.match(/^You are (.+?), an AI participant/m)?.[1] ?? req.model;
    const last =
      turnText(req.messages.at(-1)?.content ?? '')
        .split('\n\n')
        .at(-1) ?? '';
    const quoted = last.length > 80 ? `${last.slice(0, 80)}…` : last;
    let text = `I'm ${name}. I see: "${quoted}" (${req.messages.length} turns of context).`;
    // Echo any instructions placed before the roster, so tests can see prompts reach the model.
    const instructions = req.system
      .slice(0, Math.max(0, req.system.search(/^You are .+?, an AI participant/m)))
      .trim()
      .replace(/\s*\n+\s*/g, ' / ');
    if (instructions) text += ` Instructions: "${instructions.slice(0, 160)}".`;
    const mode = /You are the leader of this council/.test(req.system)
      ? 'leader'
      : /^Fusion step:/m.test(req.system)
        ? 'fusion'
        : /continuing the conversation among themselves/.test(req.system)
          ? 'self-chat'
          : undefined;
    if (mode) text += ` Mode: ${mode}.`;
    // Report attachments and web search so tests can see what reached the model.
    const all = req.messages.map((m) => turnText(m.content)).join('\n');
    const docs = all.split('<document ').length - 1;
    const images = req.messages.reduce(
      (n, m) => n + (typeof m.content === 'string' ? 0 : m.content.filter((p) => p.type === 'image').length),
      0,
    );
    const unseen = all.split("You can't view images").length - 1;
    if (docs || images || unseen) {
      text += ` Context: ${docs} document(s), ${images} image(s)${unseen ? `, ${unseen} image(s) I can't see` : ''}.`;
    }
    if (req.webSearch) text += ' Web search: on.';
    if (req.model === 'chatty') text += ` ${FILLER} ${FILLER}`;
    const delay = req.model === 'slow' ? this.delayMs * 8 : this.delayMs;
    let out = 0;
    for (const word of text.split(/(?<= )/)) {
      if (signal.aborted) return;
      await sleep(delay, undefined, { signal }).catch(() => undefined);
      if (signal.aborted) return;
      out++;
      yield { type: 'text', text: word };
    }
    yield {
      type: 'usage',
      usage: { inputTokens: Math.ceil(JSON.stringify(req).length / 4), outputTokens: out },
    };
  }
}
