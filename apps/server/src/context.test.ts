import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ContextItem, Message, Session, SessionDetail } from '@agora/shared';
import { councilConfig, mockSlot, readEvents, testApp } from './test-helpers';

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, '../test/fixtures', name));
const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

type App = ReturnType<typeof testApp>['app'];

async function upload(app: App, id: string, files: [string, Buffer | string][], folder?: string) {
  const form = new FormData();
  for (const [name, body] of files) form.append('files', new File([body], name));
  if (folder) form.append('folder', folder);
  return app.request(`/api/sessions/${id}/context/files`, { method: 'POST', body: form });
}

async function waitIdle(app: App, id: string) {
  for (let i = 0; i < 200; i++) {
    const detail = (await (await app.request(`/api/sessions/${id}`)).json()) as SessionDetail;
    if (!detail.session.running) return detail;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('still running');
}

const make = async (app: App, slots = [mockSlot('a', 'mock/echo', 'Alpha')]) =>
  (await (await app.request('/api/sessions', json({ config: councilConfig(...slots) }))).json()) as Session;

describe('attachments', () => {
  it('extracts text, code, PDF and Word files, and every model sees them', async () => {
    const { app } = testApp();
    const s = await make(app, [mockSlot('a', 'mock/echo', 'Alpha'), mockSlot('b', 'mock/echo', 'Beta')]);
    const res = await upload(app, s.id, [
      ['notes.md', '# Plan\nShip it.'],
      ['main.py', 'print("hi")'],
      ['report.pdf', fixture('sample.pdf')],
      ['brief.docx', fixture('sample.docx')],
    ]);
    expect(res.status).toBe(201);
    const { items } = (await res.json()) as { items: ContextItem[] };
    expect(items.map((i) => [i.kind, i.title])).toEqual([
      ['file', 'notes.md'],
      ['file', 'main.py'],
      ['file', 'report.pdf'],
      ['file', 'brief.docx'],
    ]);
    expect(items[2]!.text).toContain('Agora PDF fixture text');
    expect(items[3]!.text).toBe('Agora Word fixture text');
    expect(items[0]!.tokens).toBeGreaterThan(0);

    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'Summarize the files' }));
    const detail = await waitIdle(app, s.id);
    expect(detail.context).toHaveLength(4);
    for (const reply of detail.messages.slice(1))
      expect(reply.text).toContain('Context: 4 document(s), 0 image(s)');
  });

  it('sends images only to models that can see them', async () => {
    const { app } = testApp();
    const s = await make(app, [mockSlot('v', 'mock/vision', 'Seer'), mockSlot('e', 'mock/echo', 'Echo')]);
    const res = await upload(app, s.id, [['pixel.png', fixture('pixel.png')]]);
    const [image] = ((await res.json()) as { items: ContextItem[] }).items;
    expect(image).toMatchObject({ kind: 'image', mediaType: 'image/png', tokens: 1500 });
    expect(image!.data).toBe(fixture('pixel.png').toString('base64'));

    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'What is in the picture?' }));
    const [, seer, echo] = (await waitIdle(app, s.id)).messages as Message[];
    expect(seer!.text).toContain('0 document(s), 1 image(s)');
    expect(echo!.text).toContain("1 image(s) I can't see");
  });

  it('a folder becomes one attachment of readable files, skipping binaries', async () => {
    const { app } = testApp();
    const s = await make(app);
    const res = await upload(
      app,
      s.id,
      [
        ['src/b.ts', 'export const b = 2;'],
        ['src/a.ts', 'export const a = 1;'],
        ['logo.bin', Buffer.from([0, 1, 2, 0, 3])],
      ],
      'my-project',
    );
    const [folder] = ((await res.json()) as { items: ContextItem[] }).items;
    expect(folder).toMatchObject({ kind: 'folder', title: 'my-project/', note: '2 files, 1 skipped' });
    expect(folder!.text.indexOf('<file path="src/a.ts">')).toBeLessThan(folder!.text.indexOf('src/b.ts'));
  });

  it('rejects unsupported single files but skips them in a batch', async () => {
    const { app } = testApp();
    const s = await make(app);
    const bad = await upload(app, s.id, [['data.bin', Buffer.from([0, 0, 0, 1])]]);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain(
      "isn't a text, code, PDF, Word or image file",
    );
    const mixed = await upload(app, s.id, [
      ['ok.txt', 'fine'],
      ['data.bin', Buffer.from([0, 0, 0, 1])],
    ]);
    const body = (await mixed.json()) as { items: ContextItem[]; skipped: string[] };
    expect(body.items.map((i) => i.title)).toEqual(['ok.txt']);
    expect(body.skipped).toHaveLength(1);
  });

  it('removing an attachment updates every device, and the models stop seeing it', async () => {
    const { app } = testApp();
    const s = await make(app);
    const feed = await app.request(`/api/sessions/${s.id}/events`);
    const [item] = (
      (await (await upload(app, s.id, [['a.txt', 'alpha']])).json()) as { items: ContextItem[] }
    ).items;
    expect(
      (await app.request(`/api/sessions/${s.id}/context/${item!.id}`, { method: 'DELETE' })).status,
    ).toBe(204);
    const events = await readEvents(feed, (es) => es.filter((e) => e.type === 'context').length === 2);
    const contexts = events
      .filter((e) => e.type === 'context')
      .map((e) => (e.type === 'context' ? e.items.length : -1));
    expect(contexts).toEqual([1, 0]);
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'hi' }));
    expect((await waitIdle(app, s.id)).messages[1]!.text).not.toContain('Context:');
    expect(
      (await app.request(`/api/sessions/${s.id}/context/${item!.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
  });

  it('transcribes audio (mock provider) into a transcript attachment', async () => {
    const { app } = testApp();
    const s = await make(app);
    const form = new FormData();
    form.append('audio', new File([Buffer.alloc(1000)], 'memo.webm', { type: 'audio/webm' }));
    const res = await app.request(`/api/sessions/${s.id}/context/transcribe`, { method: 'POST', body: form });
    const [item] = ((await res.json()) as { items: ContextItem[] }).items;
    expect(item).toMatchObject({ kind: 'transcript', title: 'Transcript: memo.webm' });
    expect(item!.text).toContain('1000 bytes');
  });

  it('save and load carry attachments, images included', async () => {
    const { app } = testApp();
    const s = await make(app);
    await upload(app, s.id, [
      ['a.txt', 'alpha'],
      ['pixel.png', fixture('pixel.png')],
    ]);
    const file = await (await app.request(`/api/sessions/${s.id}/export`)).json();
    const copy = (await (await app.request('/api/sessions/import', json(file))).json()) as Session;
    const ctx = ((await (await app.request(`/api/sessions/${copy.id}`)).json()) as SessionDetail).context;
    expect(ctx.map((c) => [c.kind, c.title])).toEqual([
      ['file', 'a.txt'],
      ['image', 'pixel.png'],
    ]);
    expect(ctx[1]!.data).toBe(fixture('pixel.png').toString('base64'));
  });

  it('web search is passed to the models when switched on', async () => {
    const { app } = testApp();
    const s = await make(app);
    await app.request(`/api/sessions/${s.id}`, json({ config: { ...s.config, webSearch: true } }, 'PATCH'));
    await app.request(`/api/sessions/${s.id}/messages`, json({ text: 'Latest news?' }));
    expect((await waitIdle(app, s.id)).messages[1]!.text).toContain('Web search: on.');
  });
});
