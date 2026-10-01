import {
  hasRoles,
  MAX_SLOTS,
  nextSlotColor,
  slotDisplayName,
  type ModelInfo,
  type Slot,
} from '@agora/shared';
import { useState } from 'react';
import { useStore } from '../store';
import { PlusIcon, XIcon } from './icons';
import { ModelPicker } from './ModelPicker';
import { RolesModal } from './RolesModal';

function newSlotId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Picks black or white text for a slot colour. */
function textOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum > 150 ? '#111827' : '#ffffff';
}

const NO_SLOTS: Slot[] = [];

export function SlotBar() {
  const slots = useStore((s) => s.session?.config.slots ?? NO_SLOTS);
  const updateConfig = useStore((s) => s.updateConfig);
  /** Slot being edited, or 'new' to add one. */
  const [picking, setPicking] = useState<string | 'new' | null>(null);

  const pick = (model: ModelInfo) => {
    updateConfig((config) => {
      if (picking === 'new') {
        const slot: Slot = {
          id: newSlotId(),
          model: model.id,
          modelLabel: model.name,
          color: nextSlotColor(config.slots),
        };
        return { ...config, slots: [...config.slots, slot] };
      }
      return {
        ...config,
        slots: config.slots.map((s) =>
          s.id === picking ? { ...s, model: model.id, modelLabel: model.name } : s,
        ),
      };
    });
    setPicking(null);
  };

  const remove = (id: string) =>
    updateConfig((config) => ({ ...config, slots: config.slots.filter((s) => s.id !== id) }));

  return (
    <div className="grid grid-cols-2 gap-2 px-3 sm:px-4 md:grid-cols-4 md:gap-3">
      {slots.map((slot) => (
        <div
          key={slot.id}
          className="flex h-10 items-center rounded-lg shadow-sm sm:h-12 md:h-14"
          style={{ background: slot.color, color: textOn(slot.color) }}
        >
          <button
            className="flex min-w-0 flex-1 flex-col items-start px-3 text-left"
            onClick={() => setPicking(slot.id)}
            title="Change model"
          >
            <span className="w-full truncate text-sm font-semibold">{slotDisplayName(slot)}</span>
            {slot.customName && (
              <span className="w-full truncate text-[11px] opacity-75">{slot.modelLabel}</span>
            )}
          </button>
          <button
            className="mr-1.5 rounded p-1.5 opacity-60 hover:bg-black/15 hover:opacity-100"
            onClick={() => remove(slot.id)}
            aria-label={`Remove ${slotDisplayName(slot)}`}
          >
            <XIcon />
          </button>
        </div>
      ))}
      {slots.length < MAX_SLOTS && (
        <button
          className="relative flex h-10 items-center justify-center rounded-lg border border-line bg-panel text-slate-300 hover:bg-panel-2 sm:h-12 md:h-14"
          onClick={() => setPicking('new')}
          aria-label="Add model"
        >
          <span className="absolute left-2 top-1 text-[10px] text-muted">{slots.length + 1}</span>
          <PlusIcon size={18} />
        </button>
      )}
      {picking && (
        <ModelPicker
          current={slots.find((s) => s.id === picking)?.model ?? undefined}
          onPick={pick}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/** Row under the slot cards: council-wide tools. */
export function SlotToolbar() {
  const rolesActive = useStore((s) => (s.session ? hasRoles(s.session.config) : false));
  const running = useStore((s) => s.session?.running ?? false);
  const canRestore = useStore((s) => s.session?.canRestore ?? false);
  const hasMessages = useStore((s) => s.messages.length > 0);
  const clearTranscript = useStore((s) => s.clearTranscript);
  const restoreTranscript = useStore((s) => s.restoreTranscript);
  const [rolesOpen, setRolesOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 px-3 pt-2 sm:px-4">
      <button className="btn relative px-2.5 py-1 text-xs" onClick={() => setRolesOpen(true)}>
        Roles
        {rolesActive && (
          <span className="size-1.5 rounded-full bg-blue-400" title="Prompts or custom names are active" />
        )}
      </button>
      <div className="ml-auto flex items-center gap-2">
        {canRestore && (
          <button
            className="btn px-2.5 py-1 text-xs"
            onClick={() => void restoreTranscript()}
            disabled={running}
            title="Bring back the last cleared conversation"
          >
            Restore
          </button>
        )}
        <button
          className="btn px-2.5 py-1 text-xs"
          onClick={() => void clearTranscript()}
          disabled={running || !hasMessages}
          title={running ? 'Stop the responses first' : 'Clear the conversation (Restore brings it back)'}
        >
          Clear
        </button>
      </div>
      {rolesOpen && <RolesModal onClose={() => setRolesOpen(false)} />}
    </div>
  );
}
