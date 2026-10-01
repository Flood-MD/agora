import { PROVIDER_LABELS, type UpdateSettingsInput } from '@agora/shared';
import { useState } from 'react';
import { useStore } from '../store';
import { Modal } from './Modal';

type KeyedProvider = 'openai' | 'anthropic' | 'openrouter' | 'huggingface' | 'custom';

const PROVIDERS: { id: KeyedProvider; help: string }[] = [
  { id: 'openrouter', help: 'openrouter.ai/keys — one key for hundreds of models' },
  { id: 'anthropic', help: 'console.anthropic.com' },
  { id: 'openai', help: 'platform.openai.com/api-keys' },
  { id: 'huggingface', help: 'huggingface.co/settings/tokens (Inference Providers permission)' },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const [username, setUsername] = useState(settings?.username ?? '');
  const [customBaseUrl, setCustomBaseUrl] = useState(settings?.customBaseUrl ?? '');
  const [keys, setKeys] = useState<Partial<Record<KeyedProvider, string | null>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  if (!settings) return null;

  const save = async () => {
    setSaving(true);
    setError(undefined);
    const input: UpdateSettingsInput = { keys };
    if (username.trim() && username.trim() !== settings.username) input.username = username.trim();
    if (customBaseUrl.trim() !== settings.customBaseUrl) input.customBaseUrl = customBaseUrl.trim();
    try {
      await saveSettings(input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const keyRow = (id: KeyedProvider, help: string) => {
    const status = settings.providers[id];
    const pending = keys[id];
    const fromEnv = status.source === 'env';
    return (
      <div key={id} className="mb-3">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <label htmlFor={`key-${id}`} className="text-sm font-medium">
            {PROVIDER_LABELS[id]}
          </label>
          <span className={`text-xs ${status.configured ? 'text-green-400' : 'text-muted'}`}>
            {pending === null
              ? 'will be removed'
              : fromEnv
                ? 'set in .env'
                : status.configured
                  ? 'configured'
                  : 'not set'}
          </span>
        </div>
        <div className="flex gap-2">
          <input
            id={`key-${id}`}
            type="password"
            autoComplete="off"
            className="field"
            disabled={fromEnv}
            placeholder={status.hint ?? (id === 'custom' ? 'API key (optional)' : 'Paste API key')}
            value={pending ?? ''}
            onChange={(e) => setKeys((k) => ({ ...k, [id]: e.target.value }))}
          />
          {status.source === 'app' && (
            <button className="btn shrink-0" onClick={() => setKeys((k) => ({ ...k, [id]: null }))}>
              Remove
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">{fromEnv ? 'Managed by the server environment.' : help}</p>
      </div>
    );
  };

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save & Close'}
          </button>
        </>
      }
    >
      <section className="mb-5">
        <label htmlFor="username" className="mb-1 block text-sm font-medium">
          Your name
        </label>
        <input
          id="username"
          className="field"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted">How the models address you in the group chat.</p>
      </section>

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">API keys</h3>
      <p className="mb-3 text-xs text-muted">
        Keys are stored on the Agora server only and are never sent back to this browser.
      </p>
      {PROVIDERS.map((p) => keyRow(p.id, p.help))}

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Custom endpoint</h3>
      <div className="mb-3">
        <label htmlFor="custom-url" className="mb-1 block text-sm font-medium">
          OpenAI-compatible base URL
        </label>
        <input
          id="custom-url"
          className="field"
          placeholder="http://192.168.1.20:11434/v1 (Ollama, LM Studio, vLLM…)"
          value={customBaseUrl}
          onChange={(e) => setCustomBaseUrl(e.target.value)}
        />
      </div>
      {keyRow('custom', 'Only if your server requires one.')}

      {settings.mockEnabled && (
        <p className="text-xs text-muted">Mock provider is enabled (MOCK_PROVIDER=1).</p>
      )}
      {error && <p className="mt-3 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>}
    </Modal>
  );
}
