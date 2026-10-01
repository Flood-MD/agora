import { PROVIDER_LABELS, type ModelInfo, type ProviderId } from '@agora/shared';
import { useState } from 'react';
import { useStore } from '../store';

const EXAMPLES: Partial<Record<ProviderId, string>> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-5',
  openrouter: 'google/gemini-2.5-pro',
  huggingface: 'meta-llama/Llama-3.3-70B-Instruct',
  custom: 'llama3.3:70b',
  mock: 'my-test-model',
};

/** Adds a model id by hand — for models a provider serves but doesn't list (yet). */
export function AddModelById({
  initialId,
  initialProvider,
  onAdded,
}: {
  initialId: string;
  initialProvider?: ProviderId;
  onAdded: (model: ModelInfo) => void;
}) {
  const settings = useStore((s) => s.settings);
  const addCustomModel = useStore((s) => s.addCustomModel);
  const providers = (Object.keys(PROVIDER_LABELS) as ProviderId[]).filter((p) =>
    p === 'mock' ? settings?.mockEnabled : settings?.providers[p].configured,
  );
  const [provider, setProvider] = useState<ProviderId | undefined>(
    initialProvider && providers.includes(initialProvider) ? initialProvider : providers[0],
  );
  const [model, setModel] = useState(initialId.trim());
  const [name, setName] = useState('');
  const [context, setContext] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  if (!provider) {
    return (
      <p className="rounded-md bg-panel-2 px-3 py-2 text-sm text-muted">
        Configure a provider in Settings first — custom model IDs are sent through that provider.
      </p>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      const added = await addCustomModel({
        provider,
        model: model.trim(),
        name: name.trim() || undefined,
        contextLength: context ? Number(context) * 1000 : undefined,
      });
      onAdded(added);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="mb-4 rounded-lg border border-line bg-panel-2/60 p-3">
      <p className="mb-3 text-xs text-muted">
        For models a provider serves but doesn’t list yet. The ID is sent to the provider exactly as typed and
        is saved for all your devices.
      </p>
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <label className="sr-only" htmlFor="custom-provider">
          Provider
        </label>
        <select
          id="custom-provider"
          className="field"
          value={provider}
          onChange={(e) => setProvider(e.target.value as ProviderId)}
        >
          {providers.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="custom-model-id">
          Model ID
        </label>
        <input
          id="custom-model-id"
          className="field font-mono"
          placeholder={`Model ID, e.g. ${EXAMPLES[provider] ?? 'model-name'}`}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          autoFocus
          required
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
        <input
          className="field"
          placeholder="Display name (optional)"
          aria-label="Display name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="field"
          type="number"
          min={1}
          placeholder="Context (K)"
          aria-label="Context window in thousands of tokens (optional)"
          title="Optional. Lets Agora trim long chats to fit."
          value={context}
          onChange={(e) => setContext(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={saving || !model.trim()}>
          {saving ? 'Adding…' : 'Add & use'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </form>
  );
}
