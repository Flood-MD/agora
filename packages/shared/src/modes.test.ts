import { describe, expect, it } from 'vitest';
import { leaderSlot, modeInstructions, planRound, planSelfChatRound } from './modes';
import type { SessionConfig, Slot } from './types';

const slot = (id: string, model: string | null = `mock/${id}`): Slot => ({
  id,
  model,
  modelLabel: id,
  color: '#3b82f6',
});
const base: SessionConfig = {
  slots: [slot('a'), slot('empty', null), slot('b'), slot('c')],
  systemPrompt: '',
  showModelNames: false,
};

describe('planRound', () => {
  it('group round: every slot with a model answers at once', () => {
    expect(planRound(base)).toEqual([{ slotIds: ['a', 'b', 'c'] }]);
  });

  it('a message to one slot is answered by that slot only, whatever the mode', () => {
    expect(planRound({ ...base, leader: true, fusion: true }, 'b')).toEqual([{ slotIds: ['b'] }]);
  });

  it('leader: the others first, then the leader', () => {
    expect(planRound({ ...base, leader: true, leaderSlotId: 'b' })).toEqual([
      { slotIds: ['a', 'c'] },
      { slotIds: ['b'], kind: 'leader' },
    ]);
  });

  it('leader falls back to the first slot with a model when the chosen one is gone or empty', () => {
    expect(leaderSlot({ ...base, leaderSlotId: 'removed' })!.id).toBe('a');
    expect(leaderSlot({ ...base, leaderSlotId: 'empty' })!.id).toBe('a');
  });

  it('fusion: everyone, then slot 1 merges', () => {
    expect(planRound({ ...base, fusion: true })).toEqual([
      { slotIds: ['a', 'b', 'c'] },
      { slotIds: ['a'], kind: 'fusion' },
    ]);
  });

  it('leader takes precedence if both are on, and both need two models', () => {
    expect(planRound({ ...base, leader: true, fusion: true })[1]!.kind).toBe('leader');
    const solo: SessionConfig = { ...base, slots: [slot('a')], leader: true };
    expect(planRound(solo)).toEqual([{ slotIds: ['a'] }]);
    expect(planRound({ ...base, slots: [] })).toEqual([]);
  });

  it('self-chat: one model at a time in slot order', () => {
    expect(planSelfChatRound(base)).toEqual([
      { slotIds: ['a'], kind: 'self-chat' },
      { slotIds: ['b'], kind: 'self-chat' },
      { slotIds: ['c'], kind: 'self-chat' },
    ]);
  });

  it('has instructions for each special step, mentioning the user', () => {
    for (const kind of ['leader', 'fusion', 'self-chat'] as const) {
      expect(modeInstructions(kind, 'Sam')).toContain('Sam');
    }
    expect(modeInstructions(undefined, 'Sam')).toBeUndefined();
  });
});
