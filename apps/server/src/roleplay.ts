import { castSchema, MAX_SLOTS, splitModelId, type Cast, type ChatTurn, type Slot } from '@agora/shared';
import type { Providers } from './providers';
import { RequestError } from './orchestrator';

/** System prompt for Rapid Roleplay; the mock provider recognises it too. */
export const ROLEPLAY_SYSTEM =
  'You design roleplay casts for a group chat where several AI models talk with one human. Reply with a single JSON object and nothing else.';

export function roleplayPrompt(scenario: string, username: string, exact?: number): string {
  const count = exact
    ? `exactly ${exact} character${exact === 1 ? '' : 's'}`
    : `between 2 and ${MAX_SLOTS} characters (choose the number that suits the scenario)`;
  return [
    `Scenario: ${scenario}`,
    '',
    `Create ${count}, one for each AI participant. ${username} is the human in the chat and is not one of the characters.`,
    '',
    'Return JSON in this shape: {"setting": "...", "characters": [{"name": "...", "prompt": "..."}]}',
    '- setting: 2–4 sentences shared by everyone, describing the scene and how the conversation should go.',
    '- name: a short display name (1–3 words).',
    '- prompt: 2–5 sentences in the second person ("You are …") giving that character’s personality, goals and way of speaking.',
  ].join('\n');
}

/** Reads a cast from a model reply, tolerating code fences and text around the JSON. */
export function parseCast(reply: string, max: number = MAX_SLOTS): Cast {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object found');
  const cast = castSchema.parse(JSON.parse(reply.slice(start, end + 1)));
  return { ...cast, characters: cast.characters.slice(0, max) };
}

async function complete(providers: Providers, slot: Slot, messages: ChatTurn[]): Promise<string> {
  const { provider, model } = splitModelId(slot.model!);
  let text = '';
  const stream = providers
    .get(provider)
    .stream({ model, system: ROLEPLAY_SYSTEM, messages }, AbortSignal.timeout(180_000));
  for await (const event of stream) if (event.type === 'text') text += event.text;
  return text;
}

/**
 * Asks the given slot's model (slot 1 by convention) for a cast. A reply that isn't valid JSON of the
 * right shape gets one retry with the error explained.
 */
export async function generateCast(
  providers: Providers,
  slot: Slot,
  scenario: string,
  username: string,
  exact?: number,
): Promise<Cast> {
  const ask: ChatTurn = { role: 'user', content: roleplayPrompt(scenario, username, exact) };
  let reply = '';
  try {
    reply = await complete(providers, slot, [ask]);
    return parseCast(reply, exact ?? MAX_SLOTS);
  } catch (err) {
    if (!reply) throw err;
    const problem = err instanceof Error ? err.message : String(err);
    const retry = await complete(providers, slot, [
      ask,
      { role: 'assistant', content: reply },
      {
        role: 'user',
        content: `That reply could not be used (${problem.slice(0, 300)}). Reply with only the JSON object in the requested shape.`,
      },
    ]);
    try {
      return parseCast(retry, exact ?? MAX_SLOTS);
    } catch {
      throw new RequestError(
        `${slot.modelLabel} didn’t return a usable cast. Try again or rephrase the scenario.`,
        409,
      );
    }
  }
}
