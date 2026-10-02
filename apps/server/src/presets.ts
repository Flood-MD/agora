import { nanoid } from 'nanoid';
import type { Cast, RolePreset } from '@agora/shared';
import type { Db } from './db';

/** Starter setups shipped with Agora. */
export const BUILT_IN_PRESETS: RolePreset[] = [
  {
    id: 'builtin-debate',
    name: 'Debate panel',
    builtIn: true,
    cast: {
      setting:
        'A structured debate on the topic the human raises. Keep each turn focused, answer the strongest version of the other side’s argument, and concede points that are fair.',
      characters: [
        {
          name: 'Proponent',
          prompt: 'You argue for the proposition. You are confident, concrete and use examples.',
        },
        {
          name: 'Opponent',
          prompt: 'You argue against the proposition. You probe assumptions and look for costs and risks.',
        },
        {
          name: 'Moderator',
          prompt:
            'You keep the debate fair. You summarise where the sides agree, name the real disagreement, and ask sharp follow-up questions.',
        },
      ],
    },
  },
  {
    id: 'builtin-code-review',
    name: 'Code review',
    builtIn: true,
    cast: {
      setting:
        'A code review of whatever the human shares. Be specific: point to the exact code, explain the problem, and suggest a fix. Skip praise and generic advice.',
      characters: [
        {
          name: 'Architect',
          prompt: 'You review structure, naming, boundaries and how the change will age.',
        },
        {
          name: 'Security Reviewer',
          prompt: 'You look for vulnerabilities, unsafe input handling, secrets and data exposure.',
        },
        {
          name: 'Pragmatist',
          prompt: 'You weigh every suggestion against effort and risk and say what is worth doing now.',
        },
      ],
    },
  },
  {
    id: 'builtin-writers-room',
    name: "Writers' room",
    builtIn: true,
    cast: {
      setting:
        'A writers’ room developing the human’s story. Build on each other’s ideas, disagree when something doesn’t work, and keep the story’s own voice.',
      characters: [
        {
          name: 'Plotter',
          prompt: 'You think about structure, stakes, pacing and what each scene must accomplish.',
        },
        {
          name: 'Character Lead',
          prompt: 'You care about motivation, voice and whether people act like themselves.',
        },
        { name: 'Line Editor', prompt: 'You tighten prose, cut what is flat, and suggest stronger wording.' },
      ],
    },
  },
  {
    id: 'builtin-good-bad-cop',
    name: 'Good cop, bad cop',
    builtIn: true,
    cast: {
      setting:
        'A light-hearted interrogation scene. The human is being questioned about a mystery of their choosing. Stay in character and keep it playful.',
      characters: [
        {
          name: 'Good Cop',
          prompt: 'You are warm, patient and sympathetic, and try to win the suspect’s trust.',
        },
        { name: 'Bad Cop', prompt: 'You are gruff, impatient and theatrical, but never cruel.' },
      ],
    },
  },
];

const KEY = 'rolePresets';

/** Saved role setups: the built-in ones plus the user's own (stored in settings). */
export class Presets {
  constructor(private db: Db) {}

  private saved(): RolePreset[] {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as
      { value: string } | undefined;
    try {
      return row ? (JSON.parse(row.value) as RolePreset[]) : [];
    } catch {
      return [];
    }
  }

  private write(list: RolePreset[]) {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(KEY, JSON.stringify(list));
  }

  list(): RolePreset[] {
    return [...this.saved().sort((a, b) => a.name.localeCompare(b.name)), ...BUILT_IN_PRESETS];
  }

  /** Saves a setup; a user preset with the same name is replaced. */
  create(name: string, cast: Cast): RolePreset {
    const preset: RolePreset = { id: nanoid(10), name, builtIn: false, cast };
    this.write([...this.saved().filter((p) => p.name.toLowerCase() !== name.toLowerCase()), preset]);
    return preset;
  }

  get(id: string): RolePreset | undefined {
    return this.list().find((p) => p.id === id);
  }

  remove(id: string): boolean {
    const list = this.saved();
    const next = list.filter((p) => p.id !== id);
    this.write(next);
    return next.length !== list.length;
  }
}
