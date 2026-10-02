import { nextSlotColor, type SessionConfig } from './types';

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

/** A roleplay cast: a shared setting plus one character per slot (Rapid Roleplay and saved setups). */
export interface Cast {
  /** Becomes the system prompt for every model. */
  setting: string;
  characters: { name: string; prompt: string }[];
}

export interface RolePreset {
  id: string;
  name: string;
  /** Shipped with Agora; can't be deleted. */
  builtIn: boolean;
  cast: Cast;
}

/** The current roles of a chat as a cast, in slot order (slots with a model only). */
export function castOf(config: SessionConfig): Cast {
  return {
    setting: config.systemPrompt,
    characters: config.slots
      .filter((s) => s.model)
      .map((s) => ({ name: s.customName?.trim() || s.modelLabel, prompt: s.prompt ?? '' })),
  };
}

/**
 * Puts a cast into a chat: the setting becomes the system prompt and characters fill the slots that
 * have a model, in order.
 * - Without `allowOverwrite`, the council is left as is: extra characters are dropped and slots
 *   without a character keep no name or prompt.
 * - With it, the council is resized to the cast: new slots copy the first slot's model, extra slots
 *   (and empty ones) are removed.
 */
export function applyCast(
  config: SessionConfig,
  cast: Cast,
  allowOverwrite: boolean,
  newSlotId: () => string,
): SessionConfig {
  let slots = config.slots.filter((s) => s.model);
  const template = slots[0];
  if (allowOverwrite && template) {
    slots = slots.slice(0, cast.characters.length);
    while (slots.length < cast.characters.length) {
      slots.push({
        id: newSlotId(),
        model: template.model,
        modelLabel: template.modelLabel,
        color: nextSlotColor(slots),
      });
    }
  } else {
    slots = config.slots;
  }
  let i = 0;
  const filled = slots.map((slot) => {
    if (!slot.model) return slot;
    const character = cast.characters[i++];
    const { customName: _n, prompt: _p, ...rest } = slot;
    const name = character?.name.trim();
    const prompt = character?.prompt.trim();
    return { ...rest, ...(name && { customName: name }), ...(prompt && { prompt }) };
  });
  return { ...config, systemPrompt: cast.setting.trim(), slots: filled };
}
