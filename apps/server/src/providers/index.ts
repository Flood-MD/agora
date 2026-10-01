import type { ModelInfo, ProviderId } from '@agora/shared';
import type { AppConfig } from '../config';
import type { KeyedProvider, Settings } from '../settings';
import { AnthropicProvider } from './anthropic';
import { MockProvider } from './mock';
import {
  mapGenericModels,
  mapHuggingFaceModels,
  mapOpenAIModels,
  mapOpenRouterModels,
  OpenAICompatProvider,
} from './openaiCompat';
import { ProviderError, type Provider } from './types';

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

export interface Catalog {
  models: ModelInfo[];
  errors: Partial<Record<ProviderId, string>>;
}

/** Builds provider clients from current settings and caches each provider's model list. */
export class Providers {
  private cache = new Map<ProviderId, { at: number; models: ModelInfo[] }>();

  constructor(
    private settings: Settings,
    private config: AppConfig,
  ) {}

  get(id: ProviderId): Provider {
    if (!this.settings.isConfigured(id)) {
      throw new ProviderError(`${id} is not configured. Add its API key in Settings.`);
    }
    const key = id === 'mock' ? '' : (this.settings.key(id as KeyedProvider) ?? '');
    switch (id) {
      case 'mock':
        return new MockProvider(this.config.mockDelayMs);
      case 'anthropic':
        return new AnthropicProvider(key);
      case 'openai':
        return new OpenAICompatProvider({
          id,
          apiKey: key,
          baseURL: 'https://api.openai.com/v1',
          mapModels: mapOpenAIModels,
        });
      case 'openrouter':
        return new OpenAICompatProvider({
          id,
          apiKey: key,
          baseURL: 'https://openrouter.ai/api/v1',
          headers: { 'HTTP-Referer': 'https://github.com/flood-md/agora', 'X-Title': 'Agora' },
          mapModels: mapOpenRouterModels,
        });
      case 'huggingface':
        return new OpenAICompatProvider({
          id,
          apiKey: key,
          baseURL: 'https://router.huggingface.co/v1',
          mapModels: mapHuggingFaceModels,
        });
      case 'custom':
        return new OpenAICompatProvider({
          id,
          // Local servers usually ignore the key, but the SDK requires one.
          apiKey: key || 'not-needed',
          baseURL: this.settings.customBaseUrl(),
          mapModels: mapGenericModels,
        });
    }
  }

  invalidate(ids: ProviderId[]) {
    for (const id of ids) this.cache.delete(id);
  }

  async catalog(refresh = false): Promise<Catalog> {
    const ids = (['mock', 'anthropic', 'openai', 'openrouter', 'huggingface', 'custom'] as const).filter(
      (id) => this.settings.isConfigured(id),
    );
    const errors: Catalog['errors'] = {};
    const lists = await Promise.all(
      ids.map(async (id) => {
        const hit = this.cache.get(id);
        if (!refresh && hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.models;
        try {
          const models = await this.get(id).listModels();
          models.sort((a, b) => a.name.localeCompare(b.name));
          this.cache.set(id, { at: Date.now(), models });
          return models;
        } catch (err) {
          errors[id] = err instanceof Error ? err.message : String(err);
          return hit?.models ?? [];
        }
      }),
    );
    // Hand-added models come first in their provider's group. If the provider has since started
    // listing the same id, the listed entry wins (it has richer metadata) but stays marked as custom.
    const custom = this.settings
      .customModels()
      .filter((m) => ids.includes(m.provider as (typeof ids)[number]));
    const customIds = new Set(custom.map((m) => m.id));
    const listed = lists.flat();
    const listedIds = new Set(listed.map((m) => m.id));
    const models = [
      ...custom.filter((m) => !listedIds.has(m.id)),
      ...listed.map((m) => (customIds.has(m.id) ? { ...m, custom: true } : m)),
    ];
    return { models, errors };
  }

  /**
   * Whether a model accepts images: the catalogue says so where it can (OpenRouter, Anthropic);
   * otherwise a conservative guess from the id.
   */
  supportsVision(id: string): boolean {
    const known = this.cachedModel(id)?.vision;
    if (known !== undefined) return known;
    return /^(anthropic\/claude|openai\/(gpt-4o|gpt-4\.1|gpt-5|o3|o4|chatgpt-4o)|mock\/vision$)/.test(id);
  }

  /** Known info for one model: a loaded provider catalogue, or a hand-added entry. */
  cachedModel(id: string): ModelInfo | undefined {
    const custom = this.settings.customModels().find((m) => m.id === id);
    if (custom?.contextLength) return custom;
    for (const { models } of this.cache.values()) {
      const m = models.find((x) => x.id === id);
      if (m) return m;
    }
    return undefined;
  }
}
