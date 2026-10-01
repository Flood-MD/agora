import { describe, expect, it } from 'vitest';
import type { Message, Session, SessionDetail, SettingsView } from '@agora/shared';
import { councilConfig, latestMessages, mockSlot, readEvents, testApp } from './test-helpers';

const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function waitIdle(app: ReturnType<typeof testApp>['app'], id: string) {
  for (let i = 0; i < 200; i++) {
    const detail = (await (await app.request(`/api/sessions/${id}`)).json()) as SessionDetail;
    if (!detail.session.running) return detail;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('still running');
}

describe('sessions API', () => {
  it('creates, lists, renames and deletes sessions', async () => {
    const { app } = testApp();
    const created = (await (await app.request('/api/sessions', json({}))).json()) as Session;
    expect(created.title).toBe('New chat');
    expect(created.config.slots).toEqual([]);

    const renamed = await app.request(`/api/sessions/${created.id}`, json({ title: 'Renamed' }, 'PATCH'));
    expect(((await renamed.json()) as Session).title).toBe('Renamed');

    const list = (await (await app.request('/api/sessions')).json()) as Session[];
    expect(list.map((s) => s.id)).toEqual([created.id]);

    expect((await app.request(`/api/sessions/${created.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await app.request(`/api/sessions/${created.id}`)).status).toBe(404);
  });

  it('new sessions inherit the most recent council', async () => {
    const { app } = testApp();
    const config = councilConfig(mockSlot('a'), mockSlot('b'));
    await app.request('/api/sessions', json({ config }));
    const next = (await (await app.request('/api/sessions', json({}))).json()) as Session;
    expect(next.config).toEqual(config);
  });

  it('rejects stale config writes from another device', async () => {
    const { app } = testApp();
    const s = (await (await app.request('/api/sessions', json({}))).json()) as Session;
    await new Promise((r) => setTimeout(r, 2));
    const first = await app.request(
      `/api/sessions/${s.id}`,
      json({ title: 'one', baseUpdatedAt: s.updatedAt }, 'PATCH'),
    );
    expect(first.status).toBe(200);
    const stale = await app.request(
      `/api/sessions/${s.id}`,
      json({ title: 'two', baseUpdatedAt: s.updatedAt }, 'PATCH'),
    );
    expect(stale.status).toBe(409);
  });

  it('validates input', async () => {
    const { app } = testApp();
    const s = (await (await app.request('/api/sessions', json({}))).json()) as Session;
    expect((await app.request(`/api/sessions/${s.id}/messages`, json({ text: '   ' }))).status).toBe(400);
    expect(
      (await app.request(`/api/sessions/${s.id}`, json({ config: { slots: 'x' } }, 'PATCH'))).status,
    ).toBe(400);
  });
});

describe('group chat', () => {
  it('every model answers, each sees the shared transcript, and all subscribers get the stream', async () => {
    const { app } = testApp();
    const config = councilConfig(
      mockSlot('a', 'mock/echo', 'Alpha'),
      mockSlot('b', 'mock/chatty', 'Beta'),
      mockSlot('c', 'mock/echo', 'Gamma'),
    );
    const s = (await (await app.request('/api/sessions', json({ config }))).json()) as Session;

    const deviceA = await app.request(`/api/sessions/${s.id}/events`);
    const deviceB = await app.request(`/api/sessions/${s.id}/events`);
    const send = await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'Hello council' }));
    expect(send.status).toBe(202);

    const done = (events: Parameters<typeof latestMessages>[0]) => {
      const replies = latestMessages(events).filter((m) => m.author !== 'user');
      return replies.length === 3 && replies.every((m) => m.status === 'done');
    };
    const [eventsA, eventsB] = await Promise.all([readEvents(deviceA, done), readEvents(deviceB, done)]);
    expect(eventsA[0]!.type).toBe('snapshot');

    for (const events of [eventsA, eventsB]) {
      const msgs = latestMessages(events);
      expect(msgs.map((m) => m.author)).toEqual(['user', 'a', 'b', 'c']);
      expect(msgs[1]!.text).toContain("I'm Alpha");
      expect(msgs[1]!.text).toContain('[User]: Hello council');
      expect(msgs[2]!.text).toContain("I'm Beta");
      expect(msgs[2]!.usage?.outputTokens).toBeGreaterThan(0);
      // Tokens arrived incrementally, not just as a final message.
      expect(events.filter((e) => e.type === 'message' && e.message.author === 'b').length).toBeGreaterThan(
        2,
      );
    }

    // Persisted, and the title was derived from the first message.
    const detail = await waitIdle(app, s.id);
    expect(detail.messages.map((m) => m.status)).toEqual(['done', 'done', 'done', 'done']);
    expect(detail.session.title).toBe('Hello council');

    // Second round: each model now sees the others' first answers.
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'Round two' }));
    const after = await waitIdle(app, s.id);
    const alpha2 = after.messages.filter((m) => m.author === 'a').at(-1)!;
    expect(alpha2.round).toBe(2);
    expect(alpha2.text).toContain('[User]: Round two');
    expect(alpha2.text).toContain('3 turns of context'); // user, own reply, everyone else + new question
  });

  it('reports per-model errors without blocking the others', async () => {
    const { app } = testApp();
    const config = councilConfig(mockSlot('a', 'mock/echo'), mockSlot('b', 'mock/error'));
    const s = (await (await app.request('/api/sessions', json({ config }))).json()) as Session;
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'hi' }));
    const detail = await waitIdle(app, s.id);
    const [, a, b] = detail.messages as [Message, Message, Message];
    expect(a.status).toBe('done');
    expect(b.status).toBe('error');
    expect(b.error).toContain('Mock provider error');
  });

  it('reports an unconfigured provider as a message error', async () => {
    const { app } = testApp();
    const config = councilConfig(mockSlot('a', 'openai/gpt-x'));
    const s = (await (await app.request('/api/sessions', json({ config }))).json()) as Session;
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'hi' }));
    const detail = await waitIdle(app, s.id);
    expect(detail.messages[1]!.status).toBe('error');
    expect(detail.messages[1]!.error).toMatch(/not configured/);
  });

  it('refuses a second send while running, and stop ends the run', async () => {
    const { app } = testApp({ mockDelayMs: 20 });
    const config = councilConfig(mockSlot('a', 'mock/slow'));
    const s = (await (await app.request('/api/sessions', json({ config }))).json()) as Session;
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'first' }));
    expect((await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'second' }))).status).toBe(409);

    await new Promise((r) => setTimeout(r, 300));
    const stop = await app.request(`/api/sessions/${s.id}/stop`, { method: 'POST' });
    expect(await stop.json()).toEqual({ stopped: true });
    const detail = await waitIdle(app, s.id);
    const reply = detail.messages[1]!;
    expect(reply.status).toBe('stopped');
    expect(reply.text.length).toBeGreaterThan(0);
  });

  it('a session with no models just records the message', async () => {
    const { app } = testApp();
    const s = (await (await app.request('/api/sessions', json({}))).json()) as Session;
    expect((await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'alone' }))).status).toBe(202);
    const detail = await waitIdle(app, s.id);
    expect(detail.messages).toHaveLength(1);
  });
});

describe('settings', () => {
  it('stores keys write-only and lets environment keys win', async () => {
    const { app } = testApp({
      envKeys: {
        openai: 'sk-env-0000000000001234',
        anthropic: undefined,
        openrouter: undefined,
        huggingface: undefined,
        custom: undefined,
      },
    });
    const res = await app.request(
      '/api/settings',
      json(
        { username: 'Sam', keys: { anthropic: 'sk-ant-secret-abcdwxyz', openai: 'sk-app-ignored-9999' } },
        'PUT',
      ),
    );
    const view = (await res.json()) as SettingsView;
    expect(view.username).toBe('Sam');
    expect(view.providers.anthropic).toEqual({ configured: true, source: 'app', hint: 'sk-…wxyz' });
    expect(view.providers.openai).toEqual({ configured: true, source: 'env', hint: 'sk-…1234' });
    expect(view.providers.openrouter.configured).toBe(false);
    expect(JSON.stringify(view)).not.toContain('secret');

    const cleared = (await (
      await app.request('/api/settings', json({ keys: { anthropic: null } }, 'PUT'))
    ).json()) as SettingsView;
    expect(cleared.providers.anthropic.configured).toBe(false);
  });

  it('lists mock models when enabled', async () => {
    const { app } = testApp();
    const body = (await (await app.request('/api/models')).json()) as { models: { id: string }[] };
    expect(body.models.map((m) => m.id)).toContain('mock/echo');
  });
});

describe('custom models', () => {
  type CatalogBody = { models: { id: string; name: string; custom?: boolean; contextLength?: number }[] };
  const catalog = async (app: ReturnType<typeof testApp>['app']) =>
    (await (await app.request('/api/models')).json()) as CatalogBody;

  it('adds a model the provider does not list, and it can be used in a chat', async () => {
    const { app } = testApp();
    const add = await app.request(
      '/api/models/custom',
      json({ provider: 'mock', model: 'brand-new-model', name: 'Brand New', contextLength: 4096 }),
    );
    expect(add.status).toBe(201);
    expect(await add.json()).toEqual({
      id: 'mock/brand-new-model',
      provider: 'mock',
      name: 'Brand New',
      contextLength: 4096,
      custom: true,
    });

    const models = (await catalog(app)).models;
    expect(models[0]).toMatchObject({ id: 'mock/brand-new-model', custom: true });
    expect(models.filter((m) => m.id === 'mock/echo')).toHaveLength(1);

    const config = councilConfig(mockSlot('a', 'mock/brand-new-model', 'Brand New'));
    const s = (await (await app.request('/api/sessions', json({ config }))).json()) as Session;
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'hi' }));
    const detail = await waitIdle(app, s.id);
    expect(detail.messages[1]).toMatchObject({ status: 'done', model: 'mock/brand-new-model' });
  });

  it('marks a hand-added id the provider also lists, without duplicating it', async () => {
    const { app } = testApp();
    await app.request('/api/models/custom', json({ provider: 'mock', model: 'echo' }));
    const echo = (await catalog(app)).models.filter((m) => m.id === 'mock/echo');
    expect(echo).toEqual([expect.objectContaining({ name: 'Mock Echo', custom: true })]);
  });

  it('re-adding updates the entry, and removing deletes it', async () => {
    const { app } = testApp();
    await app.request('/api/models/custom', json({ provider: 'mock', model: 'x-1', name: 'First' }));
    await app.request('/api/models/custom', json({ provider: 'mock', model: 'x-1', name: 'Second' }));
    expect((await catalog(app)).models.filter((m) => m.id === 'mock/x-1').map((m) => m.name)).toEqual([
      'Second',
    ]);

    const del = await app.request(`/api/models/custom?id=${encodeURIComponent('mock/x-1')}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);
    expect((await catalog(app)).models.some((m) => m.id === 'mock/x-1')).toBe(false);
    expect((await app.request('/api/models/custom?id=mock%2Fx-1', { method: 'DELETE' })).status).toBe(404);
  });

  it('keeps models for unconfigured providers hidden until the provider is set up', async () => {
    const { app } = testApp();
    await app.request('/api/models/custom', json({ provider: 'openai', model: 'gpt-next' }));
    expect((await catalog(app)).models.some((m) => m.id === 'openai/gpt-next')).toBe(false);
  });

  it('validates the id', async () => {
    const { app } = testApp();
    for (const body of [
      { provider: 'mock', model: '' },
      { provider: 'mock', model: 'has space' },
      { provider: 'nope', model: 'x' },
    ]) {
      expect((await app.request('/api/models/custom', json(body))).status).toBe(400);
    }
  });
});

describe('roles', () => {
  it('sends the system prompt, slot prompt and custom names to each model', async () => {
    const { app } = testApp();
    const config = {
      ...councilConfig(
        { ...mockSlot('a', 'mock/echo', 'Alpha'), customName: 'Detective', prompt: 'You investigate.' },
        mockSlot('b', 'mock/echo', 'Beta'),
      ),
      systemPrompt: 'Stay in character.',
    };
    const s = (await (await app.request('/api/sessions', json({ config }))).json()) as Session;
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'Who did it?' }));
    const detail = await waitIdle(app, s.id);
    const [, a, b] = detail.messages as [Message, Message, Message];
    expect(a.authorName).toBe('Detective');
    expect(a.text).toContain("I'm Detective");
    expect(a.text).toContain('Instructions: "Stay in character. / You investigate."');
    expect(b.text).toContain("I'm Beta");
    expect(b.text).toContain('Instructions: "Stay in character."');
  });
});
