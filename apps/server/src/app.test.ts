import { describe, expect, it } from 'vitest';
import type { Message, Session, SessionConfig, SessionDetail, SettingsView } from '@agora/shared';
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
        github: undefined,
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

describe('clear and restore', () => {
  it('hides the transcript from the UI and the models, and restore brings it back in place', async () => {
    const { app } = testApp();
    const config = councilConfig(mockSlot('a', 'mock/echo', 'Alpha'));
    const s = (await (await app.request('/api/sessions', json({ config }))).json()) as Session;
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'first topic' }));
    await waitIdle(app, s.id);

    const cleared = (await (
      await app.request(`/api/sessions/${s.id}/clear`, { method: 'POST' })
    ).json()) as Session;
    expect(cleared.canRestore).toBe(true);
    expect((await waitIdle(app, s.id)).messages).toEqual([]);

    // The model no longer sees the cleared conversation.
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'second topic' }));
    const after = await waitIdle(app, s.id);
    expect(after.messages.map((m) => m.text)).toEqual([
      'second topic',
      expect.stringContaining('1 turns of context'),
    ]);

    const restored = await app.request(`/api/sessions/${s.id}/restore`, { method: 'POST' });
    expect(((await restored.json()) as Session).canRestore).toBe(false);
    const all = (await waitIdle(app, s.id)).messages;
    expect(all.map((m) => m.author)).toEqual(['user', 'a', 'user', 'a']);
    expect(all[0]!.text).toBe('first topic');
    expect(all[2]!.text).toBe('second topic');

    expect((await app.request(`/api/sessions/${s.id}/restore`, { method: 'POST' })).status).toBe(409);
  });

  it('keeps only the most recent clear', async () => {
    const { app } = testApp();
    const s = (await (await app.request('/api/sessions', json({}))).json()) as Session;
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'one' }));
    await app.request(`/api/sessions/${s.id}/clear`, { method: 'POST' });
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'two' }));
    await app.request(`/api/sessions/${s.id}/clear`, { method: 'POST' });
    await app.request(`/api/sessions/${s.id}/restore`, { method: 'POST' });
    expect((await waitIdle(app, s.id)).messages.map((m) => m.text)).toEqual(['two']);
  });

  it('pushes the cleared transcript to every device', async () => {
    const { app } = testApp();
    const s = (await (await app.request('/api/sessions', json({}))).json()) as Session;
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'hello' }));
    const feed = await app.request(`/api/sessions/${s.id}/events`);
    await app.request(`/api/sessions/${s.id}/clear`, { method: 'POST' });
    const events = await readEvents(feed, (es) => es.filter((e) => e.type === 'snapshot').length === 2);
    const last = events.at(-1)!;
    expect(last.type === 'snapshot' && last.detail.messages).toEqual([]);
    expect(last.type === 'snapshot' && last.detail.session.canRestore).toBe(true);
  });

  it('refuses while models are responding', async () => {
    const { app } = testApp({ mockDelayMs: 20 });
    const s = (await (
      await app.request('/api/sessions', json({ config: councilConfig(mockSlot('a', 'mock/slow')) }))
    ).json()) as Session;
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'go' }));
    expect((await app.request(`/api/sessions/${s.id}/clear`, { method: 'POST' })).status).toBe(409);
    await app.request(`/api/sessions/${s.id}/stop`, { method: 'POST' });
    await waitIdle(app, s.id);
  });
});

describe('save and load', () => {
  it('round-trips a chat through the export file into a new chat', async () => {
    const { app } = testApp();
    const config = {
      ...councilConfig(
        { ...mockSlot('a', 'mock/echo', 'Alpha'), customName: 'Judge' },
        mockSlot('b', 'mock/error'),
      ),
      systemPrompt: 'Court is in session.',
    };
    const s = (await (await app.request('/api/sessions', json({ config }))).json()) as Session;
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'Opening statements' }));
    const original = await waitIdle(app, s.id);

    const res = await app.request(`/api/sessions/${s.id}/export`);
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="agora-Opening-statements-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const file = await res.json();
    expect(file).toMatchObject({ format: 'agora.session', version: 1, title: 'Opening statements', config });

    const imported = (await (await app.request('/api/sessions/import', json(file))).json()) as Session;
    expect(imported.id).not.toBe(s.id);
    expect(imported.title).toBe('Opening statements');
    expect(imported.config).toEqual(config);
    const copy = await waitIdle(app, imported.id);
    const strip = (m: Message) => [m.author, m.authorName, m.text, m.status, m.error, m.round, m.usage];
    expect(copy.messages.map(strip)).toEqual(original.messages.map(strip));
    expect(copy.messages.map((m) => m.seq)).toEqual([1, 2, 3]);

    // The copy keeps working as a normal chat.
    await app.request(`/api/sessions/${imported.id}/messages`, json({ text: 'Next' }));
    expect((await waitIdle(app, imported.id)).messages).toHaveLength(6);
  });

  it('marks a reply that was still streaming as interrupted', async () => {
    const { app } = testApp();
    const file = {
      format: 'agora.session',
      version: 1,
      exportedAt: Date.now(),
      title: 'Half done',
      config: councilConfig(mockSlot('a')),
      messages: [
        {
          round: 1,
          author: 'user',
          authorName: 'Sam',
          text: 'Hi',
          status: 'done',
          audience: 'all',
          createdAt: 1,
        },
        {
          round: 1,
          author: 'a',
          authorName: 'a',
          text: 'Hel',
          status: 'streaming',
          audience: 'all',
          createdAt: 2,
        },
      ],
    };
    const imported = (await (await app.request('/api/sessions/import', json(file))).json()) as Session;
    const reply = (await waitIdle(app, imported.id)).messages[1]!;
    expect(reply.status).toBe('interrupted');
    expect(reply.error).toMatch(/still generating/);
  });

  it('rejects files that are not Agora exports', async () => {
    const { app } = testApp();
    for (const body of [{}, { format: 'other', version: 1 }, { format: 'agora.session', version: 2 }]) {
      expect((await app.request('/api/sessions/import', json(body))).status).toBe(400);
    }
    expect((await app.request('/api/sessions')).status).toBe(200);
    expect(((await (await app.request('/api/sessions')).json()) as unknown[]).length).toBe(0);
  });
});

describe('past chats', () => {
  it('lists chats with message counts and finds them by title or message text', async () => {
    const { app } = testApp();
    const make = async (text: string) => {
      const s = (await (await app.request('/api/sessions', json({}))).json()) as Session;
      await app.request(`/api/sessions/${s.id}/messages`, json({ text }));
      return s.id;
    };
    const pasta = await make('Best pasta recipe?');
    const budget = await make('Plan a budget: 50% savings, rest_of it spent on Pasta night');
    const other = await make('Something else entirely');

    type Summary = { id: string; messageCount: number; match?: string };
    const list = async (q = '') =>
      (await (
        await app.request(`/api/sessions${q ? `?q=${encodeURIComponent(q)}` : ''}`)
      ).json()) as Summary[];

    const all = await list();
    expect(all.map((s) => s.id)).toEqual([other, budget, pasta]);
    expect(all[0]!.messageCount).toBe(1);

    expect((await list('pasta')).map((s) => s.id)).toEqual([budget, pasta]);
    expect((await list('pasta')).find((s) => s.id === budget)!.match).toContain('Pasta night');
    // LIKE wildcards are matched literally.
    expect((await list('50%')).map((s) => s.id)).toEqual([budget]);
    expect((await list('t_of')).map((s) => s.id)).toEqual([budget]);
    expect(await list('%')).toHaveLength(1);
    expect(await list('nothing like this')).toEqual([]);

    // Cleared messages are not searchable.
    await app.request(`/api/sessions/${other}/clear`, { method: 'POST' });
    expect(await list('entirely')).toHaveLength(1); // still matches by title
    await app.request(`/api/sessions/${other}`, json({ title: 'Renamed' }, 'PATCH'));
    expect(await list('entirely')).toEqual([]);
  });
});

describe('modes', () => {
  const create = async (app: ReturnType<typeof testApp>['app'], config: SessionConfig) =>
    (await (await app.request('/api/sessions', json({ config }))).json()) as Session;
  const trio = (extra: Partial<SessionConfig> = {}): SessionConfig => ({
    ...councilConfig(
      mockSlot('a', 'mock/echo', 'Alpha'),
      mockSlot('b', 'mock/echo', 'Beta'),
      mockSlot('c', 'mock/echo', 'Gamma'),
    ),
    ...extra,
  });

  it('leader answers last, after seeing the others', async () => {
    const { app } = testApp();
    const s = await create(app, trio({ leader: true, leaderSlotId: 'b' }));
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'Decide' }));
    const msgs = (await waitIdle(app, s.id)).messages;
    expect(msgs.map((m) => m.author)).toEqual(['user', 'a', 'c', 'b']);
    const leader = msgs[3]!;
    expect(leader.kind).toBe('leader');
    expect(leader.text).toContain('Mode: leader.');
    expect(leader.text).toContain('[Gamma]'); // saw the others' answers
    expect(msgs[1]!.text).not.toContain('Mode:');
  });

  it('fusion: slot 1 merges everyone’s answers', async () => {
    const { app } = testApp();
    const s = await create(app, trio({ fusion: true }));
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'Ideas?' }));
    const msgs = (await waitIdle(app, s.id)).messages;
    expect(msgs.map((m) => [m.author, m.kind])).toEqual([
      ['user', undefined],
      ['a', undefined],
      ['b', undefined],
      ['c', undefined],
      ['a', 'fusion'],
    ]);
    expect(msgs[4]!.text).toContain('Mode: fusion.');
    expect(msgs[4]!.text).toContain('[Gamma]');
  });

  it('self-chat runs the requested rounds, one model at a time, with an optional topic', async () => {
    const { app } = testApp();
    const s = await create(
      app,
      councilConfig(mockSlot('a', 'mock/echo', 'Alpha'), mockSlot('b', 'mock/echo', 'Beta')),
    );
    const res = await app.request(
      `/api/sessions/${s.id}/self-chat`,
      json({ rounds: 2, topic: 'Cats or dogs?' }),
    );
    expect(res.status).toBe(202);
    const msgs = (await waitIdle(app, s.id)).messages;
    expect(msgs.map((m) => `${m.author}${m.round}`)).toEqual(['user1', 'a1', 'b1', 'a2', 'b2']);
    expect(msgs.slice(1).every((m) => m.kind === 'self-chat' && m.text.includes('Mode: self-chat.'))).toBe(
      true,
    );
    expect(msgs[2]!.text).toContain('[Alpha]'); // Beta saw Alpha's turn
    expect(msgs[4]!.text).toContain('[Alpha]'); // and Alpha's second turn

    // Without a topic it just continues.
    await app.request(`/api/sessions/${s.id}/self-chat`, json({ rounds: 1 }));
    expect((await waitIdle(app, s.id)).messages.map((m) => `${m.author}${m.round}`).slice(5)).toEqual([
      'a3',
      'b3',
    ]);
  });

  it('self-chat validates rounds and needs a model; stop ends it early', async () => {
    const { app } = testApp({ mockDelayMs: 10 });
    const empty = await create(app, councilConfig());
    expect((await app.request(`/api/sessions/${empty.id}/self-chat`, json({ rounds: 2 }))).status).toBe(400);
    const s = await create(app, councilConfig(mockSlot('a', 'mock/slow')));
    expect((await app.request(`/api/sessions/${s.id}/self-chat`, json({ rounds: 0 }))).status).toBe(400);
    expect((await app.request(`/api/sessions/${s.id}/self-chat`, json({ rounds: 21 }))).status).toBe(400);
    await app.request(`/api/sessions/${s.id}/self-chat`, json({ rounds: 5 }));
    await new Promise((r) => setTimeout(r, 150));
    await app.request(`/api/sessions/${s.id}/stop`, { method: 'POST' });
    const msgs = (await waitIdle(app, s.id)).messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.status).toBe('stopped');
  });

  it('regenerate replaces the last round’s replies using the same plan', async () => {
    const { app } = testApp();
    const s = await create(app, trio({ fusion: true }));
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'Q1' }));
    const before = (await waitIdle(app, s.id)).messages;
    expect((await app.request(`/api/sessions/${s.id}/regenerate`, { method: 'POST' })).status).toBe(202);
    const after = (await waitIdle(app, s.id)).messages;
    expect(after.map((m) => [m.author, m.kind])).toEqual(before.map((m) => [m.author, m.kind]));
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after.slice(1).every((m, i) => m.id !== before[i + 1]!.id)).toBe(true);

    const empty = await create(app, trio());
    expect((await app.request(`/api/sessions/${empty.id}/regenerate`, { method: 'POST' })).status).toBe(409);
  });
});

describe('messages to one model', () => {
  it('visible: only the target answers, and everyone sees it later', async () => {
    const { app } = testApp();
    const config = councilConfig(mockSlot('a', 'mock/echo', 'Alpha'), mockSlot('b', 'mock/echo', 'Beta'));
    const s = (await (
      await app.request('/api/sessions', json({ config: { ...config, leader: true } }))
    ).json()) as Session;
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'Only you, Beta', target: 'b' }));
    let msgs = (await waitIdle(app, s.id)).messages;
    expect(msgs.map((m) => [m.author, m.audience, m.target, m.kind])).toEqual([
      ['user', 'all', 'b', undefined],
      ['b', 'all', undefined, undefined],
    ]);
    expect(msgs[1]!.text).toContain('[User, to Beta]: Only you, Beta');

    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'Everyone now' }));
    msgs = (await waitIdle(app, s.id)).messages;
    expect(msgs.find((m) => m.author === 'a' && m.round === 2)!.text).toContain('3 turns of context');
  });

  it('rejects unknown targets and private messages without one', async () => {
    const { app } = testApp();
    const s = (await (
      await app.request('/api/sessions', json({ config: councilConfig(mockSlot('a')) }))
    ).json()) as Session;
    expect(
      (await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'x', target: 'zz' }))).status,
    ).toBe(400);
    expect(
      (await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'x', private: true }))).status,
    ).toBe(400);
  });

  it('private: the exchange never reaches another model, in any mode', async () => {
    const seen = new Map<string, string[]>();
    const { app } = testApp();
    // Record every request the mock provider receives.
    const { MockProvider } = await import('./providers/mock');
    const original = MockProvider.prototype.stream;
    MockProvider.prototype.stream = function (req, signal) {
      const name = req.system.match(/^You are (.+?), an AI participant/m)![1]!;
      seen.set(name, [...(seen.get(name) ?? []), JSON.stringify(req)]);
      return original.call(this, req, signal);
    };
    try {
      const config = councilConfig(
        mockSlot('a', 'mock/echo', 'Alpha'),
        mockSlot('b', 'mock/echo', 'Beta'),
        mockSlot('c', 'mock/echo', 'Gamma'),
      );
      const s = (await (await app.request('/api/sessions', json({ config }))).json()) as Session;
      await app.request(
        `/api/sessions/${s.id}/messages`,
        json({ text: 'SECRET-PASSPHRASE', target: 'b', private: true }),
      );
      const msgs = (await waitIdle(app, s.id)).messages;
      expect(msgs.map((m) => [m.author, m.audience])).toEqual([
        ['user', 'b'],
        ['b', 'b'],
      ]);
      expect(msgs[1]!.text).toContain('Private message from User');

      // Exercise every mode afterwards; Beta's private reply quotes the secret, so check for it too.
      const patch = (extra: Partial<SessionConfig>) =>
        app.request(`/api/sessions/${s.id}`, json({ config: { ...config, ...extra } }, 'PATCH'));
      await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'group' }));
      await waitIdle(app, s.id);
      await patch({ leader: true, leaderSlotId: 'a' });
      await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'leader round' }));
      await waitIdle(app, s.id);
      await patch({ fusion: true });
      await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'fusion round' }));
      await waitIdle(app, s.id);
      await app.request(`/api/sessions/${s.id}/self-chat`, json({ rounds: 1 }));
      await waitIdle(app, s.id);
      await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'DM to Gamma', target: 'c' }));
      await waitIdle(app, s.id);
      await app.request(`/api/sessions/${s.id}/regenerate`, { method: 'POST' });
      await waitIdle(app, s.id);

      for (const name of ['Alpha', 'Gamma']) {
        expect(seen.get(name)!.length).toBeGreaterThan(3);
        for (const req of seen.get(name)!) expect(req).not.toContain('SECRET-PASSPHRASE');
      }
      expect(
        seen
          .get('Beta')!
          .slice(1)
          .every((req) => req.includes('SECRET-PASSPHRASE')),
      ).toBe(true);
    } finally {
      MockProvider.prototype.stream = original;
    }
  });
});
