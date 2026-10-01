import type { ChatTurn, ModelInfo, ProviderId, Usage } from '@agora/shared';

export interface ChatRequest {
  /** Provider-local model id (without the `provider/` prefix). */
  model: string;
  system: string;
  messages: ChatTurn[];
  maxTokens?: number;
}

export type ChatEvent = { type: 'text'; text: string } | { type: 'usage'; usage: Usage };

export interface Provider {
  id: ProviderId;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}

/** An error whose message is safe and useful to show in the chat. */
export class ProviderError extends Error {}

export async function fetchJson<T>(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, { headers, signal: signal ?? AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ProviderError(`${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`);
  }
  return (await res.json()) as T;
}
