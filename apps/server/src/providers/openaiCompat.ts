import OpenAI from 'openai';
import type { ModelInfo, ProviderId } from '@agora/shared';
import { fetchJson, type ChatEvent, type ChatRequest, type Provider } from './types';

export interface OpenAICompatOptions {
  id: ProviderId;
  baseURL: string;
  apiKey: string;
  headers?: Record<string, string>;
  /** Turns the provider's raw `/models` payload into our catalogue entries. */
  mapModels: (data: unknown[], id: ProviderId) => ModelInfo[];
}

/** One adapter for every OpenAI-compatible API: OpenAI, OpenRouter, Hugging Face router, custom servers. */
export class OpenAICompatProvider implements Provider {
  readonly id: ProviderId;
  private client: OpenAI;

  constructor(private opts: OpenAICompatOptions) {
    this.id = opts.id;
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      defaultHeaders: opts.headers,
      maxRetries: 1,
    });
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const url = `${this.opts.baseURL.replace(/\/$/, '')}/models`;
    const body = await fetchJson<{ data?: unknown[] }>(
      url,
      { Authorization: `Bearer ${this.opts.apiKey}`, ...this.opts.headers },
      signal,
    );
    return this.opts.mapModels(body.data ?? [], this.id);
  }

  async *stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    // No max_tokens: OpenAI's newer models reject it in favour of max_completion_tokens,
    // and every provider here has a sensible default.
    const stream = await this.client.chat.completions.create(
      {
        model: req.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          ...(req.system ? [{ role: 'system' as const, content: req.system }] : []),
          ...req.messages,
        ],
      },
      { signal },
    );
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield { type: 'text', text };
      if (chunk.usage) {
        yield {
          type: 'usage',
          usage: { inputTokens: chunk.usage.prompt_tokens, outputTokens: chunk.usage.completion_tokens },
        };
      }
    }
  }
}

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

const OPENAI_CHAT = /^(gpt-|chatgpt-|o\d)/;
const OPENAI_EXCLUDE =
  /(audio|realtime|transcribe|tts|image|embedding|search|moderation|instruct|codex|-pro\b)/;

export function mapOpenAIModels(data: unknown[], id: ProviderId): ModelInfo[] {
  return (data as Raw[])
    .map((m) => str(m.id))
    .filter((mid): mid is string => !!mid && OPENAI_CHAT.test(mid) && !OPENAI_EXCLUDE.test(mid))
    .map((mid) => ({ id: `${id}/${mid}`, provider: id, name: mid }));
}

export function mapOpenRouterModels(data: unknown[], id: ProviderId): ModelInfo[] {
  return (data as Raw[]).flatMap((m) => {
    const mid = str(m.id);
    if (!mid) return [];
    const arch = (m.architecture ?? {}) as Raw;
    const outputs = (arch.output_modalities as string[] | undefined) ?? ['text'];
    if (!outputs.includes('text')) return [];
    const pricing = (m.pricing ?? {}) as Raw;
    const prompt = Number(pricing.prompt);
    const completion = Number(pricing.completion);
    const top = (m.top_provider ?? {}) as Raw;
    return [
      {
        id: `${id}/${mid}`,
        provider: id,
        name: str(m.name) ?? mid,
        contextLength: num(m.context_length),
        maxOutput: num(top.max_completion_tokens),
        vision: ((arch.input_modalities as string[] | undefined) ?? []).includes('image'),
        pricing:
          Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0
            ? { prompt: prompt * 1e6, completion: completion * 1e6 }
            : undefined,
      },
    ];
  });
}

export function mapHuggingFaceModels(data: unknown[], id: ProviderId): ModelInfo[] {
  return (data as Raw[]).flatMap((m) => {
    const mid = str(m.id);
    if (!mid) return [];
    const providers = (m.providers as Raw[] | undefined) ?? [];
    const contextLength = providers.map((p) => num(p.context_length)).find((n) => n !== undefined);
    return [{ id: `${id}/${mid}`, provider: id, name: mid, contextLength }];
  });
}

export function mapGenericModels(data: unknown[], id: ProviderId): ModelInfo[] {
  return (data as Raw[]).flatMap((m) => {
    const mid = str(m.id);
    return mid ? [{ id: `${id}/${mid}`, provider: id, name: mid }] : [];
  });
}
