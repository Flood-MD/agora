import type {
  CustomModelInput,
  ModelInfo,
  ProviderId,
  ProviderStatus,
  SettingsView,
  UpdateSettingsInput,
} from '@agora/shared';
import type { AppConfig } from './config';
import type { Db } from './db';

export type KeyedProvider = Exclude<ProviderId, 'mock'>;
export const KEYED_PROVIDERS: KeyedProvider[] = [
  'openai',
  'anthropic',
  'openrouter',
  'huggingface',
  'custom',
];

export function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  const prefix = key.match(/^[a-z]+[-_]/i)?.[0] ?? '';
  return `${prefix}…${key.slice(-4)}`;
}

export class Settings {
  constructor(
    private db: Db,
    private config: AppConfig,
  ) {}

  private get(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value;
  }

  private set(key: string, value: string | null) {
    if (value === null || value === '') this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    else
      this.db
        .prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        )
        .run(key, value);
  }

  username(): string {
    return this.get('username') || 'User';
  }

  customBaseUrl(): string {
    return this.config.envCustomBaseUrl || this.get('customBaseUrl') || '';
  }

  /** The key to use for a provider: environment first, then one saved in the app. */
  key(provider: KeyedProvider): string | undefined {
    return this.config.envKeys[provider] || this.get(`key.${provider}`) || undefined;
  }

  isConfigured(provider: ProviderId): boolean {
    if (provider === 'mock') return this.config.mock;
    if (provider === 'custom') return Boolean(this.customBaseUrl());
    return Boolean(this.key(provider));
  }

  private status(provider: KeyedProvider): ProviderStatus {
    const env = this.config.envKeys[provider];
    const app = this.get(`key.${provider}`);
    const key = env || app;
    return {
      configured: this.isConfigured(provider),
      source: env ? 'env' : app ? 'app' : null,
      hint: key ? maskKey(key) : null,
    };
  }

  view(): SettingsView {
    return {
      username: this.username(),
      customBaseUrl: this.customBaseUrl(),
      providers: Object.fromEntries(
        KEYED_PROVIDERS.map((p) => [p, this.status(p)]),
      ) as SettingsView['providers'],
      mockEnabled: this.config.mock,
    };
  }

  /** Models added by hand, for every provider (configured or not). */
  customModels(): ModelInfo[] {
    try {
      return JSON.parse(this.get('customModels') ?? '[]') as ModelInfo[];
    } catch {
      return [];
    }
  }

  /** Adds (or updates) a hand-entered model and returns it. */
  addCustomModel(input: CustomModelInput): ModelInfo {
    const model: ModelInfo = {
      id: `${input.provider}/${input.model}`,
      provider: input.provider,
      name: input.name || input.model,
      contextLength: input.contextLength,
      custom: true,
    };
    const others = this.customModels().filter((m) => m.id !== model.id);
    this.set('customModels', JSON.stringify([...others, model]));
    return model;
  }

  removeCustomModel(id: string): boolean {
    const list = this.customModels();
    const next = list.filter((m) => m.id !== id);
    this.set('customModels', next.length ? JSON.stringify(next) : null);
    return next.length !== list.length;
  }

  /** Applies an update and returns the providers whose credentials changed. */
  update(input: UpdateSettingsInput): KeyedProvider[] {
    const changed: KeyedProvider[] = [];
    if (input.username !== undefined) this.set('username', input.username);
    if (input.customBaseUrl !== undefined) {
      this.set('customBaseUrl', input.customBaseUrl);
      changed.push('custom');
    }
    for (const p of KEYED_PROVIDERS) {
      const value = input.keys?.[p];
      if (value === undefined) continue;
      this.set(`key.${p}`, value);
      if (!changed.includes(p)) changed.push(p);
    }
    return changed;
  }
}
