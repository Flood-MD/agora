import Anthropic from '@anthropic-ai/sdk';
import type { ChatTurn, ModelInfo } from '@agora/shared';
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
    const messages: Anthropic.MessageParam[] = req.messages.map(toMessageParam);
    const tools = req.webSearch ? [webSearchTool(req.model)] : undefined;
    const usage = { inputTokens: 0, outputTokens: 0 };
    // A long web search can pause the turn; resume it by sending the paused turn back.
    for (let attempt = 0; attempt <= MAX_PAUSE_RESUMES; attempt++) {
      const stream = this.client.messages.stream(
        {
          model: req.model,
          max_tokens: Math.min(req.maxTokens ?? DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS),
          ...(req.system ? { system: req.system } : {}),
          messages,
          ...(tools && { tools }),
        },
        { signal },
      );
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        }
      }
      const final = await stream.finalMessage();
      usage.inputTokens += final.usage.input_tokens;
      usage.outputTokens += final.usage.output_tokens;
      if (final.stop_reason === 'refusal') {
        yield { type: 'usage', usage };
        throw new Error('The model declined to respond (refusal).');
      }
      if (final.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: final.content });
    }
    yield { type: 'usage', usage };
  }
}

const MAX_PAUSE_RESUMES = 3;

/** Claude 4.6 and later use the newer web search tool; older models use the basic one. */
function webSearchTool(model: string): Anthropic.ToolUnion {
  const modern = /claude-(fable|mythos)|claude-(opus|sonnet)-(4-[6-9]|[5-9])/.test(model);
  return modern
    ? ({ type: 'web_search_20260209', name: 'web_search', max_uses: 5 } as unknown as Anthropic.ToolUnion)
    : { type: 'web_search_20250305', name: 'web_search', max_uses: 5 };
}

function toMessageParam(turn: ChatTurn): Anthropic.MessageParam {
  if (typeof turn.content === 'string') return { role: turn.role, content: turn.content };
  return {
    role: turn.role,
    content: turn.content.map((p) =>
      p.type === 'text'
        ? { type: 'text' as const, text: p.text }
        : {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: p.mediaType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
              data: p.data,
            },
          },
    ),
  };
}
