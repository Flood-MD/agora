import { setTimeout as sleep } from 'node:timers/promises';
import type { ModelInfo } from '@agora/shared';
import { ProviderError, type ChatEvent, type ChatRequest, type Provider } from './types';

const MODELS: ModelInfo[] = [
  { id: 'mock/echo', provider: 'mock', name: 'Mock Echo', contextLength: 32_000 },
  { id: 'mock/chatty', provider: 'mock', name: 'Mock Chatty', contextLength: 32_000 },
  { id: 'mock/slow', provider: 'mock', name: 'Mock Slow', contextLength: 32_000 },
  { id: 'mock/error', provider: 'mock', name: 'Mock Error', contextLength: 32_000 },
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
    const name = req.system.match(/^You are (.+?), an AI participant/m)?.[1] ?? req.model;
    const last = req.messages.at(-1)?.content.split('\n\n').at(-1) ?? '';
    const quoted = last.length > 80 ? `${last.slice(0, 80)}…` : last;
    let text = `I'm ${name}. I see: "${quoted}" (${req.messages.length} turns of context).`;
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
