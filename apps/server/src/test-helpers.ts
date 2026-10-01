import type { Message, SessionConfig, SessionEvent, Slot } from '@agora/shared';
import { config as baseConfig, type AppConfig } from './config';
import { createApp } from './app';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...baseConfig,
    mock: true,
    mockDelayMs: 1,
    webDist: '/nonexistent',
    envKeys: {
      openai: undefined,
      anthropic: undefined,
      openrouter: undefined,
      huggingface: undefined,
      custom: undefined,
    },
    envCustomBaseUrl: undefined,
    ...overrides,
  };
}

export function testApp(overrides: Partial<AppConfig> = {}) {
  return createApp(testConfig(overrides), ':memory:');
}

export const mockSlot = (id: string, model = 'mock/echo', label = id): Slot => ({
  id,
  model,
  modelLabel: label,
  color: '#3b82f6',
});

export const councilConfig = (...slots: Slot[]): SessionConfig => ({
  slots,
  systemPrompt: '',
  showModelNames: false,
});

/** Reads SSE `data:` events from a streaming response until `until` returns true. */
export async function readEvents(
  res: Response,
  until: (events: SessionEvent[]) => boolean,
  timeoutMs = 5000,
): Promise<SessionEvent[]> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const events: SessionEvent[] = [];
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (!until(events)) {
      if (Date.now() > deadline) throw new Error(`Timed out; got ${events.map((e) => e.type).join(',')}`);
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let i;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const data = chunk
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');
        if (data) events.push(JSON.parse(data));
      }
    }
  } finally {
    await reader.cancel();
  }
  return events;
}

/** Latest version of each message seen in an event list. */
export function latestMessages(events: SessionEvent[]): Message[] {
  const byId = new Map<string, Message>();
  for (const e of events) {
    if (e.type === 'snapshot') e.detail.messages.forEach((m) => byId.set(m.id, m));
    if (e.type === 'message') byId.set(e.message.id, e.message);
  }
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}
