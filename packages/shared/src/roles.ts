import type { SessionConfig } from './types';

/** The parts of a session config edited in the Roles panel. */
export interface Roles {
  systemPrompt: string;
  showModelNames: boolean;
  /** Keyed by slot id. */
  slots: Record<string, { customName: string; prompt: string }>;
}

export function rolesOf(config: SessionConfig): Roles {
  return {
    systemPrompt: config.systemPrompt,
    showModelNames: config.showModelNames,
    slots: Object.fromEntries(
      config.slots.map((s) => [s.id, { customName: s.customName ?? '', prompt: s.prompt ?? '' }]),
    ),
  };
}

export function emptyRoles(config: SessionConfig): Roles {
  return {
    systemPrompt: '',
    showModelNames: false,
    slots: Object.fromEntries(config.slots.map((s) => [s.id, { customName: '', prompt: '' }])),
  };
}

/**
 * Writes edited roles back into a config. Slots that were removed meanwhile (e.g. on another device)
 * are ignored, and slots added meanwhile keep their current values. Blank values are stored as absent.
 */
export function applyRoles(config: SessionConfig, roles: Roles): SessionConfig {
  return {
    ...config,
    systemPrompt: roles.systemPrompt.trim(),
    showModelNames: roles.showModelNames,
    slots: config.slots.map((slot) => {
      const edit = roles.slots[slot.id];
      if (!edit) return slot;
      const { customName: _n, prompt: _p, ...rest } = slot;
      const customName = edit.customName.trim();
      const prompt = edit.prompt.trim();
      return { ...rest, ...(customName && { customName }), ...(prompt && { prompt }) };
    }),
  };
}

/** True when any prompt or custom name is in effect (shown as a marker on the Roles button). */
export function hasRoles(config: SessionConfig): boolean {
  return Boolean(config.systemPrompt) || config.slots.some((s) => s.customName || s.prompt);
}
