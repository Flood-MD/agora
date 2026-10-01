import type { MessageKind, SessionConfig, Slot } from './types';

/** One step of a round: these slots answer in parallel, seeing everything from earlier steps. */
export interface Step {
  slotIds: string[];
  kind?: MessageKind;
}

export function activeSlots(config: SessionConfig): Slot[] {
  return config.slots.filter((s) => s.model);
}

/** The leader slot: the chosen one if it still has a model, else the first slot with a model. */
export function leaderSlot(config: SessionConfig): Slot | undefined {
  const active = activeSlots(config);
  return active.find((s) => s.id === config.leaderSlotId) ?? active[0];
}

/** Fusion is written by slot 1's model (the first slot with a model). */
export function fusionSlot(config: SessionConfig): Slot | undefined {
  return activeSlots(config)[0];
}

/**
 * Plans the round that answers a user message.
 * - Sent to one slot: only that slot answers (modes don't apply).
 * - Leader: everyone else answers in parallel, then the leader answers seeing them.
 * - Fusion: everyone answers, then slot 1 merges the answers.
 * Leader and Fusion need at least two models; with one they behave like a plain group round.
 */
export function planRound(config: SessionConfig, target?: string): Step[] {
  if (target) return [{ slotIds: [target] }];
  const active = activeSlots(config).map((s) => s.id);
  if (!active.length) return [];
  if (active.length > 1 && config.leader) {
    const leader = leaderSlot(config)!.id;
    return [{ slotIds: active.filter((id) => id !== leader) }, { slotIds: [leader], kind: 'leader' }];
  }
  if (active.length > 1 && config.fusion) {
    return [{ slotIds: active }, { slotIds: [fusionSlot(config)!.id], kind: 'fusion' }];
  }
  return [{ slotIds: active }];
}

/** One Self-Chat round: each model takes a turn in slot order, seeing the turns before it. */
export function planSelfChatRound(config: SessionConfig): Step[] {
  return activeSlots(config).map((s) => ({ slotIds: [s.id], kind: 'self-chat' as const }));
}

/** Extra system-prompt instructions for a step of the given kind. */
export function modeInstructions(kind: MessageKind | undefined, username: string): string | undefined {
  switch (kind) {
    case 'leader':
      return `You are the leader of this council. The other participants have already answered ${username}'s latest message (above). Weigh their answers, settle any disagreements, and give the final answer.`;
    case 'fusion':
      return `Fusion step: combine the answers above to ${username}'s latest message into one best answer. Keep what is correct and useful from each, resolve disagreements, and drop repetition. Write the answer itself rather than describing how you merged it.`;
    case 'self-chat':
      return `${username} has stepped back, and the AI participants are continuing the conversation among themselves. Respond to what the others said, add something new, and keep it conversational and fairly brief.`;
    default:
      return undefined;
  }
}
