import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;

export const config = {
  host: env.HOST || '0.0.0.0',
  port: Number(env.PORT || 8080),
  dataDir: path.resolve(env.DATA_DIR || './data'),
  /** Built SPA served in production (in dev, Vite serves the UI). Served only if it exists. */
  webDist: path.resolve(
    env.WEB_DIST || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist'),
  ),
  mock: env.MOCK_PROVIDER === '1' || env.MOCK_PROVIDER === 'true',
  mockDelayMs: Number(env.MOCK_DELAY_MS || 25),
  envKeys: {
    openai: env.OPENAI_API_KEY || undefined,
    anthropic: env.ANTHROPIC_API_KEY || undefined,
    openrouter: env.OPENROUTER_API_KEY || undefined,
    huggingface: env.HF_TOKEN || undefined,
    custom: env.CUSTOM_API_KEY || undefined,
  },
  envCustomBaseUrl: env.CUSTOM_BASE_URL || undefined,
};

export type AppConfig = typeof config;
