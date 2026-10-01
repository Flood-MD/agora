import Anthropic from '@anthropic-ai/sdk';
import type { ModelInfo } from '@agora/shared';
import type { ChatEvent, ChatRequest, Provider } from './types';

/** Cap per reply; the model's own output limit applies when lower. */
const DEFAULT_MAX_TOKENS = 32_000;

export class AnthropicProvider implements Provider {
  readonly id = 'anthropic' as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 1 });
  }

  async listModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    for await (const m of this.client.models.list()) {
      const extra = m as unknown as { max_input_tokens?: number; max_tokens?: number };
      models.push({
        id: `anthropic/${m.id}`,
        provider: 'anthropic',
        name: m.display_name,
        contextLength: extra.max_input_tokens,
        maxOutput: extra.max_tokens,
        vision: true,
      });
    }
    return models;
  }

  async *stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    const stream = this.client.messages.stream(
      {
        model: req.model,
        max_tokens: Math.min(req.maxTokens ?? DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS),
        ...(req.system ? { system: req.system } : {}),
        messages: req.messages,
      },
      { signal },
    );
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text };
      }
    }
    const final = await stream.finalMessage();
    yield {
      type: 'usage',
      usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
    };
    if (final.stop_reason === 'refusal') {
      throw new Error('The model declined to respond (refusal).');
    }
  }
}
