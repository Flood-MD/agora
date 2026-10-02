import { describe, expect, it } from 'vitest';
import { applyCast, applyRoles, castOf, emptyRoles, hasRoles, rolesOf } from './roles';
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

describe('casts', () => {
  const cast = (n: number) => ({
    setting: ' A courtroom. ',
    characters: Array.from({ length: n }, (_, i) => ({ name: `C${i + 1}`, prompt: `You are C${i + 1}.` })),
  });
  let ids = 0;
  const newId = () => `new${++ids}`;

  it('fills slots with a model, in order, and sets the setting', () => {
    const cfg: SessionConfig = { ...config, slots: [slot('a'), { ...slot('x'), model: null }, slot('b')] };
    const out = applyCast(cfg, cast(2), false, newId);
    expect(out.systemPrompt).toBe('A courtroom.');
    expect(out.slots.map((s) => [s.id, s.customName, s.prompt])).toEqual([
      ['a', 'C1', 'You are C1.'],
      ['x', undefined, undefined],
      ['b', 'C2', 'You are C2.'],
    ]);
  });

  it('without overwrite keeps the council: extra characters dropped, spare slots cleared', () => {
    expect(applyCast(config, cast(5), false, newId).slots).toHaveLength(2);
    const out = applyCast(config, cast(1), false, newId);
    expect(out.slots[1]).toEqual(slot('b'));
  });

  it('with overwrite resizes the council, copying slot 1’s model', () => {
    const grown = applyCast(config, cast(4), true, newId);
    expect(grown.slots.map((s) => s.customName)).toEqual(['C1', 'C2', 'C3', 'C4']);
    expect(grown.slots[3]).toMatchObject({ model: 'mock/a', modelLabel: 'A' });
    // New slots get colours not already in use (the two fixture slots share one).
    const added = grown.slots.slice(2).map((s) => s.color);
    expect(new Set([config.slots[0]!.color, ...added]).size).toBe(3);
    const shrunk = applyCast(
      { ...config, slots: [...config.slots, { ...slot('e'), model: null }] },
      cast(1),
      true,
      newId,
    );
    expect(shrunk.slots.map((s) => s.id)).toEqual(['a']);
  });

  it('castOf reads the current roles back', () => {
    expect(castOf(config)).toEqual({
      setting: 'Be brief.',
      characters: [
        { name: 'Ann', prompt: 'You are a lawyer.' },
        { name: 'B', prompt: '' },
      ],
    });
  });
});
