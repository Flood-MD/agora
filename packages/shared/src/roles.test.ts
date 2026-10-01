import { describe, expect, it } from 'vitest';
import { applyRoles, emptyRoles, hasRoles, rolesOf } from './roles';
import type { SessionConfig, Slot } from './types';

const slot = (id: string, extra: Partial<Slot> = {}): Slot => ({
  id,
  model: `mock/${id}`,
  modelLabel: id.toUpperCase(),
  color: '#3b82f6',
  ...extra,
});

const config: SessionConfig = {
  systemPrompt: 'Be brief.',
  showModelNames: false,
  slots: [slot('a', { customName: 'Ann', prompt: 'You are a lawyer.' }), slot('b')],
};

describe('roles', () => {
  it('round-trips a config through the editable form', () => {
    expect(applyRoles(config, rolesOf(config))).toEqual(config);
  });

  it('trims values and drops blank names and prompts', () => {
    const roles = rolesOf(config);
    roles.systemPrompt = '  New rules  ';
    roles.showModelNames = true;
    roles.slots.a = { customName: '   ', prompt: '' };
    roles.slots.b = { customName: ' Bob ', prompt: ' You are a judge. ' };
    const out = applyRoles(config, roles);
    expect(out.systemPrompt).toBe('New rules');
    expect(out.showModelNames).toBe(true);
    expect(out.slots[0]).toEqual(slot('a'));
    expect(out.slots[1]).toEqual(slot('b', { customName: 'Bob', prompt: 'You are a judge.' }));
  });

  it('ignores edits for removed slots and leaves new slots untouched', () => {
    const roles = rolesOf(config);
    roles.slots.a!.customName = 'Changed';
    const later: SessionConfig = { ...config, slots: [slot('b'), slot('c', { customName: 'Cy' })] };
    const out = applyRoles(later, roles);
    expect(out.slots.map((s) => s.id)).toEqual(['b', 'c']);
    expect(out.slots[1]!.customName).toBe('Cy');
  });

  it('clear all empties every field', () => {
    const out = applyRoles(config, emptyRoles(config));
    expect(out.systemPrompt).toBe('');
    expect(out.slots.every((s) => !s.customName && !s.prompt)).toBe(true);
    expect(hasRoles(out)).toBe(false);
    expect(hasRoles(config)).toBe(true);
  });
});
