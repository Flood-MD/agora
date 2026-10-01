import { describe, expect, it } from 'vitest';
import { mapHuggingFaceModels, mapOpenAIModels, mapOpenRouterModels } from './openaiCompat';

describe('model catalogue mappers', () => {
  it('keeps only chat models from OpenAI', () => {
    const ids = mapOpenAIModels(
      [
        { id: 'gpt-4.1' },
        { id: 'o4-mini' },
        { id: 'text-embedding-3-small' },
        { id: 'gpt-4o-realtime-preview' },
        { id: 'dall-e-3' },
      ],
      'openai',
    ).map((m) => m.id);
    expect(ids).toEqual(['openai/gpt-4.1', 'openai/o4-mini']);
  });

  it('maps OpenRouter metadata and per-token prices to per-million', () => {
    const [m] = mapOpenRouterModels(
      [
        {
          id: 'google/gemini-x',
          name: 'Google: Gemini X',
          context_length: 1_000_000,
          pricing: { prompt: '0.0000003', completion: '0.0000025' },
          architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
          top_provider: { max_completion_tokens: 65_536 },
        },
        { id: 'img/only', architecture: { output_modalities: ['image'] } },
      ],
      'openrouter',
    );
    expect(m).toMatchObject({
      id: 'openrouter/google/gemini-x',
      name: 'Google: Gemini X',
      contextLength: 1_000_000,
      maxOutput: 65_536,
      vision: true,
    });
    expect(m!.pricing!.prompt).toBeCloseTo(0.3);
    expect(m!.pricing!.completion).toBeCloseTo(2.5);
  });

  it('maps Hugging Face router models', () => {
    const [m] = mapHuggingFaceModels(
      [
        {
          id: 'meta-llama/Llama-3.3-70B-Instruct',
          providers: [{ provider: 'x' }, { provider: 'y', context_length: 131072 }],
        },
      ],
      'huggingface',
    );
    expect(m).toEqual({
      id: 'huggingface/meta-llama/Llama-3.3-70B-Instruct',
      provider: 'huggingface',
      name: 'meta-llama/Llama-3.3-70B-Instruct',
      contextLength: 131072,
    });
  });
});
