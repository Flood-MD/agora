import { describe, expect, it } from 'vitest';
import type { Cast, RolePreset, Session } from '@agora/shared';
import { parseCast, roleplayPrompt } from './roleplay';
import { councilConfig, mockSlot, testApp } from './test-helpers';

const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('parseCast', () => {
  const cast = { setting: 'A ship.', characters: [{ name: 'Captain', prompt: 'You command.' }] };

  it('reads JSON wrapped in prose or code fences', () => {
    expect(parseCast(JSON.stringify(cast))).toEqual(cast);
    expect(parseCast(`Sure!\n\`\`\`json\n${JSON.stringify(cast)}\n\`\`\`\nEnjoy.`)).toEqual(cast);
  });

  it('caps the number of characters', () => {
    const many = {
      setting: '',
      characters: Array.from({ length: 5 }, (_, i) => ({ name: `N${i}`, prompt: '' })),
    };
    expect(parseCast(JSON.stringify(many), 2).characters).toHaveLength(2);
  });

  it('rejects replies without a valid cast', () => {
    expect(() => parseCast('no json here')).toThrow();
    expect(() => parseCast('{"setting": "x", "characters": []}')).toThrow();
    expect(() => parseCast('{"setting": "x", "characters": [{"name": ""}]}')).toThrow();
  });

  it('asks for an exact count when the council must not change', () => {
    expect(roleplayPrompt('A heist', 'Sam', 3)).toContain('exactly 3 characters');
    expect(roleplayPrompt('A heist', 'Sam')).toContain('between 2 and 8 characters');
    expect(roleplayPrompt('A heist', 'Sam')).toContain('Sam is the human');
  });
});

describe('rapid roleplay', () => {
  const make = async (app: ReturnType<typeof testApp>['app'], n: number) =>
    (await (
      await app.request(
        '/api/sessions',
        json({
          config: councilConfig(
            ...Array.from({ length: n }, (_, i) => mockSlot(`s${i}`, 'mock/echo', `M${i}`)),
          ),
        }),
      )
    ).json()) as Session;

  it('fills the existing slots when overwriting is not allowed', async () => {
    const { app } = testApp();
    const s = await make(app, 2);
    const res = await app.request(
      `/api/sessions/${s.id}/roleplay`,
      json({ scenario: 'A pirate ship', allowOverwrite: false }),
    );
    expect(res.status).toBe(200);
    const { session, cast } = (await res.json()) as { session: Session; cast: Cast };
    expect(cast.characters).toHaveLength(2);
    expect(session.config.systemPrompt).toBe('Mock setting for: A pirate ship');
    expect(session.config.slots.map((x) => [x.id, x.customName, x.prompt])).toEqual([
      ['s0', 'Character 1', 'You are character 1 in A pirate ship.'],
      ['s1', 'Character 2', 'You are character 2 in A pirate ship.'],
    ]);
  });

  it('resizes the council when allowed', async () => {
    const { app } = testApp();
    const s = await make(app, 1);
    const res = await app.request(
      `/api/sessions/${s.id}/roleplay`,
      json({ scenario: 'A heist', allowOverwrite: true }),
    );
    const { session } = (await res.json()) as { session: Session };
    expect(session.config.slots).toHaveLength(3); // the mock picks 3 when free to choose
    expect(session.config.slots.every((x) => x.model === 'mock/echo')).toBe(true);
  });

  it('needs a model and a scenario', async () => {
    const { app } = testApp();
    const empty = await make(app, 0);
    expect(
      (await app.request(`/api/sessions/${empty.id}/roleplay`, json({ scenario: 'x', allowOverwrite: true })))
        .status,
    ).toBe(400);
    const s = await make(app, 1);
    expect(
      (await app.request(`/api/sessions/${s.id}/roleplay`, json({ scenario: '  ', allowOverwrite: true })))
        .status,
    ).toBe(400);
  });

  it('reports a model that fails instead of answering', async () => {
    const { app } = testApp();
    const s = (await (
      await app.request('/api/sessions', json({ config: councilConfig(mockSlot('a', 'mock/error')) }))
    ).json()) as Session;
    const res = await app.request(
      `/api/sessions/${s.id}/roleplay`,
      json({ scenario: 'x', allowOverwrite: false }),
    );
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain('Mock provider error');
  });
});

describe('saved setups', () => {
  it('lists built-ins, saves, applies and deletes user setups', async () => {
    const { app } = testApp();
    const list = async () => (await (await app.request('/api/presets')).json()) as RolePreset[];
    const builtIns = await list();
    expect(builtIns.length).toBeGreaterThanOrEqual(3);
    expect(builtIns.every((p) => p.builtIn)).toBe(true);

    const cast: Cast = { setting: 'Mine', characters: [{ name: 'Solo', prompt: 'You are alone.' }] };
    const saved = (await (
      await app.request('/api/presets', json({ name: 'My setup', cast }))
    ).json()) as RolePreset;
    expect((await list())[0]).toEqual(saved);
    // Same name replaces.
    await app.request('/api/presets', json({ name: 'my setup', cast: { ...cast, setting: 'Mine v2' } }));
    expect((await list()).filter((p) => !p.builtIn).map((p) => p.cast.setting)).toEqual(['Mine v2']);

    const s = (await (
      await app.request('/api/sessions', json({ config: councilConfig(mockSlot('a'), mockSlot('b')) }))
    ).json()) as Session;
    const applied = (await (
      await app.request(`/api/sessions/${s.id}/cast`, json({ cast: builtIns[0]!.cast, allowOverwrite: true }))
    ).json()) as Session;
    expect(applied.config.slots.map((x) => x.customName)).toEqual(
      builtIns[0]!.cast.characters.map((c) => c.name),
    );
    expect(applied.config.systemPrompt).toBe(builtIns[0]!.cast.setting);

    expect((await app.request(`/api/presets/${builtIns[0]!.id}`, { method: 'DELETE' })).status).toBe(400);
    const mine = (await list()).find((p) => !p.builtIn)!;
    expect((await app.request(`/api/presets/${mine.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await list()).some((p) => !p.builtIn)).toBe(false);
  });
});
