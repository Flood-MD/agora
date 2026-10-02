import { castOf, type RolePreset, type Session } from '@agora/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { TrashIcon } from './icons';

const OVERWRITE_KEY = 'agora.roleplay.overwrite';

/**
 * Rapid Roleplay: slot 1's model turns a scenario into a cast (setting, names, prompts).
 * Also lists saved setups, built-in and the user's own.
 */
export function RapidRoleplay({ onApplied }: { onApplied: (session: Session) => void }) {
  const session = useStore((s) => s.session);
  const showToast = useStore((s) => s.showToast);
  const [scenario, setScenario] = useState('');
  const [overwrite, setOverwrite] = useState(() => {
    try {
      return localStorage.getItem(OVERWRITE_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [busy, setBusy] = useState<string>();
  const [presets, setPresets] = useState<RolePreset[]>();

  useEffect(() => {
    api
      .presets()
      .then(setPresets)
      .catch(() => setPresets([]));
  }, []);

  if (!session) return null;
  const first = session.config.slots.find((s) => s.model);
  const fail = (err: unknown) => showToast(err instanceof Error ? err.message : String(err));

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    try {
      await work();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(undefined);
    }
  };

  const generate = () =>
    run('generate', async () => {
      const { session: updated } = await api.roleplay(session.id, scenario.trim(), overwrite);
      onApplied(updated);
    });

  const applyPreset = (preset: RolePreset) =>
    run(preset.id, async () => onApplied(await api.applyCast(session.id, preset.cast, overwrite)));

  const saveCurrent = () => {
    const name = prompt('Name this setup')?.trim();
    if (!name) return;
    void run('save', async () => {
      await api.createPreset(name, castOf(session.config));
      setPresets(await api.presets());
    });
  };

  const remove = (preset: RolePreset) => {
    if (!confirm(`Delete the setup “${preset.name}”?`)) return;
    void run(preset.id, async () => {
      await api.deletePreset(preset.id);
      setPresets(await api.presets());
    });
  };

  return (
    <section role="tabpanel" aria-label="Rapid Roleplay">
      <h3 className="font-semibold">Rapid Roleplay Generator</h3>
      <p className="mb-3 text-xs text-muted">
        Describe a scenario and {first ? first.customName || first.modelLabel : 'slot 1’s model'} will write a
        character for each model. This replaces the current system prompt, names and slot prompts.
      </p>
      <textarea
        className="field min-h-28 resize-y"
        placeholder="e.g. a pirate crew planning a heist, a startup board meeting, or good cop / bad cop"
        aria-label="Scenario"
        maxLength={5000}
        value={scenario}
        onChange={(e) => setScenario(e.target.value)}
      />
      <button
        className="btn btn-primary mt-3 w-full"
        onClick={() => void generate()}
        disabled={!scenario.trim() || !first || !!busy}
      >
        {busy === 'generate' ? 'Generating…' : 'Generate Roleplay'}
      </button>
      {!first && (
        <p className="mt-2 text-xs text-amber-400">Add a model first: slot 1’s model writes the roles.</p>
      )}
      <label className="mt-3 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          className="size-4 accent-blue-500"
          checked={overwrite}
          onChange={(e) => {
            setOverwrite(e.target.checked);
            try {
              localStorage.setItem(OVERWRITE_KEY, String(e.target.checked));
            } catch {
              // storage unavailable
            }
          }}
        />
        Allow changing the number of models (new ones use slot 1’s model)
      </label>

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Saved setups</h3>
          <button className="btn px-2.5 py-1 text-xs" onClick={saveCurrent} disabled={!!busy}>
            Save current roles…
          </button>
        </div>
        {presets === undefined && <p className="text-xs text-muted">Loading…</p>}
        <ul className="-mx-2">
          {presets?.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {p.name}
                  {p.builtIn && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-muted">built-in</span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted">
                  {p.cast.characters.map((c) => c.name).join(', ')}
                </span>
              </span>
              <button
                className="btn px-2.5 py-1 text-xs"
                onClick={() => void applyPreset(p)}
                disabled={!!busy || !first}
                aria-label={`Use ${p.name}`}
              >
                {busy === p.id ? '…' : 'Use'}
              </button>
              {!p.builtIn && (
                <button
                  className="rounded p-1.5 text-muted hover:text-red-400"
                  onClick={() => remove(p)}
                  aria-label={`Delete ${p.name}`}
                >
                  <TrashIcon size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
