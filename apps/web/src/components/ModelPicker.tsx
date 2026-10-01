import { PROVIDER_LABELS, type ModelInfo, type ProviderId } from '@agora/shared';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { RefreshIcon, SearchIcon } from './icons';
import { Modal } from './Modal';

const MAX_PER_PROVIDER = 200;

function formatContext(n?: number) {
  if (!n) return null;
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}K`;
}

function formatPrice(m: ModelInfo) {
  if (!m.pricing) return null;
  if (m.pricing.prompt === 0 && m.pricing.completion === 0) return 'free';
  return `$${+m.pricing.prompt.toFixed(2)}/$${+m.pricing.completion.toFixed(2)}`;
}

export function ModelPicker({
  current,
  onPick,
  onClose,
}: {
  current?: string;
  onPick: (model: ModelInfo) => void;
  onClose: () => void;
}) {
  const catalog = useStore((s) => s.catalog);
  const loadCatalog = useStore((s) => s.loadCatalog);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!catalog.loaded && !catalog.loading) void loadCatalog();
  }, [catalog.loaded, catalog.loading, loadCatalog]);

  const groups = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = catalog.models.filter((m) => {
      const hay = `${m.name} ${m.id}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    const byProvider = new Map<ProviderId, ModelInfo[]>();
    for (const m of matches) {
      const list = byProvider.get(m.provider) ?? [];
      list.push(m);
      byProvider.set(m.provider, list);
    }
    return [...byProvider.entries()];
  }, [catalog.models, query]);

  const errors = Object.entries(catalog.errors) as [ProviderId, string][];

  return (
    <Modal title="Choose a model" onClose={onClose} wide>
      <div className="sticky -top-4 z-10 -mx-5 -mt-4 flex gap-2 bg-panel px-5 pb-3 pt-4">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            autoFocus
            className="field pl-9"
            placeholder="Search models, e.g. “claude”, “gemini flash”, “llama 70b”"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className="btn"
          onClick={() => void loadCatalog(true)}
          disabled={catalog.loading}
          title="Refresh model lists"
          aria-label="Refresh model lists"
        >
          <RefreshIcon className={catalog.loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {errors.map(([provider, error]) => (
        <p key={provider} className="mb-2 rounded-md bg-red-950/50 px-3 py-2 text-xs text-red-300">
          {PROVIDER_LABELS[provider]}: {error}
        </p>
      ))}

      {catalog.loading && !catalog.models.length && (
        <p className="py-6 text-center text-sm text-muted">Loading models…</p>
      )}
      {catalog.loaded && !catalog.models.length && (
        <p className="py-6 text-center text-sm text-muted">
          No providers are configured yet. Open Settings (the round button at the top right) and add an API
          key.
        </p>
      )}
      {catalog.models.length > 0 && !groups.length && (
        <p className="py-6 text-center text-sm text-muted">No models match “{query}”.</p>
      )}

      {groups.map(([provider, models]) => (
        <section key={provider} className="mb-4">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
            {PROVIDER_LABELS[provider]} <span className="font-normal">({models.length})</span>
          </h3>
          <ul>
            {models.slice(0, MAX_PER_PROVIDER).map((m) => (
              <li key={m.id}>
                <button
                  className={`flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left hover:bg-panel-2 ${
                    m.id === current ? 'bg-panel-2 ring-1 ring-accent' : ''
                  }`}
                  onClick={() => onPick(m)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{m.name}</span>
                    {m.name !== m.id.slice(provider.length + 1) && (
                      <span className="block truncate text-xs text-muted">
                        {m.id.slice(provider.length + 1)}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {[formatContext(m.contextLength), formatPrice(m)].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
            {models.length > MAX_PER_PROVIDER && (
              <li className="px-2 py-1 text-xs text-muted">
                {models.length - MAX_PER_PROVIDER} more — refine your search to see them.
              </li>
            )}
          </ul>
        </section>
      ))}
    </Modal>
  );
}
