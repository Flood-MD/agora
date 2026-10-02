import { applyRoles, emptyRoles, rolesOf, slotDisplayName, type Roles } from '@agora/shared';
import { useState } from 'react';
import { useStore } from '../store';
import { Modal } from './Modal';
import { RapidRoleplay } from './RapidRoleplay';

type Tab = 'roleplay' | 'system' | 'names' | 'slots';

const TABS: { id: Tab; label: string }[] = [
  { id: 'roleplay', label: 'Rapid Roleplay' },
  { id: 'system', label: 'System Prompt' },
  { id: 'names', label: 'Custom Names' },
  { id: 'slots', label: 'Slot Prompts' },
];

/** Roles panel: global system prompt, per-slot names and prompts. Edits a draft; Save & Close commits. */
export function RolesModal({ onClose }: { onClose: () => void }) {
  const config = useStore((s) => s.session?.config);
  const updateConfig = useStore((s) => s.updateConfig);
  const adoptSession = useStore((s) => s.adoptSession);
  const [tab, setTab] = useState<Tab>('roleplay');
  const [initial, setInitial] = useState(() => (config ? rolesOf(config) : undefined));
  const [draft, setDraft] = useState<Roles | undefined>(initial);

  if (!config || !draft) return null;
  const slots = config.slots.filter((s) => draft.slots[s.id]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  const cancel = () => {
    if (!dirty || confirm('Discard your changes to the roles?')) onClose();
  };
  const save = () => {
    updateConfig((current) => applyRoles(current, draft));
    onClose();
  };
  const setSlot = (id: string, patch: Partial<Roles['slots'][string]>) =>
    setDraft((d) => d && { ...d, slots: { ...d.slots, [id]: { ...d.slots[id]!, ...patch } } });

  const noSlots = (
    <p className="text-sm text-muted">
      Add models to the council first — names and prompts are set per slot.
    </p>
  );

  return (
    <Modal
      title="Roles"
      onClose={cancel}
      wide
      footer={
        <>
          <button className="btn btn-danger mr-auto" onClick={() => setDraft(emptyRoles(config))}>
            Clear All
          </button>
          <button className="btn" onClick={cancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save &amp; Close
          </button>
        </>
      }
    >
      <div role="tablist" className="-mx-5 -mt-4 mb-4 flex overflow-x-auto border-b border-line px-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium ${
              tab === t.id
                ? 'border-accent text-blue-400'
                : 'border-transparent text-slate-300 hover:text-white'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'roleplay' && (
        <RapidRoleplay
          onApplied={(session) => {
            // The cast is already saved; show the result for review and tweaks.
            adoptSession(session);
            const roles = rolesOf(session.config);
            setInitial(roles);
            setDraft(roles);
            setTab('names');
          }}
        />
      )}

      {tab === 'system' && (
        <section role="tabpanel" aria-label="System Prompt">
          <h3 className="font-semibold">System Prompt</h3>
          <p className="mb-3 text-xs text-muted">Included with every message sent to every model.</p>
          <textarea
            className="field min-h-40 resize-y"
            placeholder="Enter a system prompt for all models…"
            aria-label="System prompt for all models"
            maxLength={50_000}
            value={draft.systemPrompt}
            onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
          />
        </section>
      )}

      {tab === 'names' && (
        <section role="tabpanel" aria-label="Custom Names">
          <h3 className="font-semibold">Customize Model Names</h3>
          <p className="mb-3 text-xs text-muted">
            How each model appears in the chat — and what the other models call it.
          </p>
          {slots.length === 0 && noSlots}
          <div className="grid gap-2">
            {slots.map((slot) => (
              <label key={slot.id} className="grid items-center gap-1 sm:grid-cols-[11rem_1fr] sm:gap-3">
                <span className="flex min-w-0 items-center gap-2 text-xs text-slate-300">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: slot.color }} />
                  <span className="truncate">{slot.modelLabel}</span>
                </span>
                <input
                  className="field"
                  placeholder={`Custom name for ${slot.modelLabel}…`}
                  maxLength={100}
                  value={draft.slots[slot.id]!.customName}
                  onChange={(e) => setSlot(slot.id, { customName: e.target.value })}
                />
              </label>
            ))}
          </div>
          <label className="mt-4 flex items-start gap-3 border-t border-line pt-4">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-blue-500"
              checked={draft.showModelNames}
              onChange={(e) => setDraft({ ...draft, showModelNames: e.target.checked })}
            />
            <span>
              <span className="block text-sm font-medium">Show model names underneath</span>
              <span className="block text-xs text-muted">
                Display the model name below custom names in the chat
              </span>
            </span>
          </label>
        </section>
      )}

      {tab === 'slots' && (
        <section role="tabpanel" aria-label="Slot Prompts">
          <h3 className="font-semibold">Slot-specific System Prompts</h3>
          <p className="mb-3 text-xs text-muted">Added after the system prompt, for one model only.</p>
          {slots.length === 0 && noSlots}
          <div className="grid gap-4">
            {slots.map((slot, i) => (
              <label key={slot.id} className="block">
                <span className="mb-1 flex items-center gap-2 text-xs font-semibold">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: slot.color }} />
                  Slot {i + 1}: {draft.slots[slot.id]!.customName.trim() || slotDisplayName(slot)}
                </span>
                <textarea
                  className="field min-h-20 resize-y"
                  placeholder={`System prompt for slot ${i + 1}…`}
                  maxLength={20_000}
                  value={draft.slots[slot.id]!.prompt}
                  onChange={(e) => setSlot(slot.id, { prompt: e.target.value })}
                />
              </label>
            ))}
          </div>
        </section>
      )}
    </Modal>
  );
}
