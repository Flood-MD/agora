import { describe, expect, it } from 'vitest';
import { buildMessages, cleanReply, turnText, type ContentPart } from './buildMessages';
import type { ContextItem, Message, SessionConfig, Slot } from './types';

const slot = (id: string, label: string, extra: Partial<Slot> = {}): Slot => ({
  id,
  model: `mock/${id}`,
  modelLabel: label,
  color: '#3b82f6',
  ...extra,
});

const a = slot('a', 'Alpha');
const b = slot('b', 'Beta');
const c = slot('c', 'Gamma');
const config: SessionConfig = { slots: [a, b, c], systemPrompt: '', showModelNames: false };

let seq = 0;
const msg = (author: string, text: string, extra: Partial<Message> = {}): Message => ({
  id: `m${++seq}`,
  sessionId: 's',
  seq,
  round: 1,
  author,
  authorName: author,
  text,
  status: 'done',
  audience: 'all',
  createdAt: 0,
  ...extra,
});

describe('buildMessages', () => {
  it('maps own messages to assistant and others to prefixed user turns', () => {
    const history = [msg('user', 'Hi all'), msg('a', 'Hello from A'), msg('b', 'Hello from B')];
    const out = buildMessages({ slot: a, config, history, username: 'Sam' });
    expect(out.messages).toEqual([
      { role: 'user', content: '[Sam]: Hi all' },
      { role: 'assistant', content: 'Hello from A' },
      { role: 'user', content: '[Beta]: Hello from B' },
    ]);
  });

  it('merges adjacent user turns so roles alternate', () => {
    const history = [msg('user', 'Q'), msg('b', 'B says'), msg('c', 'C says')];
    const out = buildMessages({ slot: a, config, history, username: 'Sam' });
    expect(out.messages).toEqual([
      { role: 'user', content: '[Sam]: Q\n\n[Beta]: B says\n\n[Gamma]: C says' },
    ]);
  });

  it('always starts and ends with a user turn', () => {
    const out = buildMessages({ slot: a, config, history: [msg('a', 'I spoke first')], username: 'Sam' });
    expect(out.messages[0]!.role).toBe('user');
    expect(out.messages.at(-1)!.role).toBe('user');
    expect(out.messages).toHaveLength(3);
    expect(buildMessages({ slot: a, config, history: [], username: 'Sam' }).messages).toHaveLength(1);
  });

  it('ignores streaming, errored and empty messages', () => {
    const history = [
      msg('user', 'Q'),
      msg('b', 'partial', { status: 'streaming' }),
      msg('c', '', { status: 'error', error: 'boom' }),
      msg('b', '   '),
    ];
    const out = buildMessages({ slot: a, config, history, username: 'Sam' });
    expect(out.messages).toEqual([{ role: 'user', content: '[Sam]: Q' }]);
  });

  it('keeps stopped (partial) replies', () => {
    const history = [msg('user', 'Q'), msg('b', 'half an answer', { status: 'stopped' })];
    const out = buildMessages({ slot: a, config, history, username: 'Sam' });
    expect(out.messages[0]!.content).toContain('[Beta]: half an answer');
  });

  it('hides private messages from other slots and flags them for the target', () => {
    const history = [
      msg('user', 'public'),
      msg('user', 'secret for B', { audience: 'b' }),
      msg('b', 'secret reply', { audience: 'b' }),
    ];
    const forA = buildMessages({ slot: a, config, history, username: 'Sam' });
    const forC = buildMessages({ slot: c, config, history, username: 'Sam' });
    for (const out of [forA, forC]) {
      const all = out.system + JSON.stringify(out.messages);
      expect(all).not.toContain('secret');
      expect(out.system).not.toContain('Private message');
    }
    const forB = buildMessages({ slot: b, config, history, username: 'Sam' });
    expect(forB.messages).toEqual([
      { role: 'user', content: '[Sam]: public\n\n[Private message from Sam]: secret for B' },
      { role: 'assistant', content: 'secret reply' },
      { role: 'user', content: '(Continue the conversation.)' },
    ]);
    expect(forB.system).toContain('Private message from Sam');
  });

  it('uses custom names, current names for present slots, and snapshot names for removed ones', () => {
    const renamed: SessionConfig = { ...config, slots: [a, { ...b, customName: 'Detective' }] };
    const history = [msg('b', 'from b'), msg('c', 'from c', { authorName: 'Old Gamma' })];
    const out = buildMessages({ slot: a, config: renamed, history, username: 'Sam' });
    expect(out.messages[0]!.content).toBe('[Detective]: from b\n\n[Old Gamma]: from c');
  });

  it('composes system prompt: global, slot prompt, roster', () => {
    const cfg: SessionConfig = {
      ...config,
      systemPrompt: 'Be brief.',
      slots: [{ ...a, prompt: 'You are a pirate.' }, b],
    };
    const out = buildMessages({ slot: cfg.slots[0]!, config: cfg, history: [], username: 'Sam' });
    expect(out.system.startsWith('Be brief.\n\nYou are a pirate.\n\nYou are Alpha')).toBe(true);
    expect(out.system).toContain('The other AI participants are: Beta.');
  });

  it('roster ignores empty slots', () => {
    const cfg: SessionConfig = { ...config, slots: [a, { ...b, model: null }] };
    const out = buildMessages({ slot: a, config: cfg, history: [], username: 'Sam' });
    expect(out.system).toContain('only AI participant');
  });

  it('trims oldest history to fit the context window', () => {
    const history = Array.from({ length: 50 }, (_, i) =>
      msg(i % 2 ? 'b' : 'user', `${i} ${'x'.repeat(400)}`),
    );
    const out = buildMessages({ slot: a, config, history, username: 'Sam', contextLength: 2000 });
    expect(out.trimmed).toBe(true);
    const text = out.messages.map((m) => m.content).join('');
    expect(text).toContain('49 ');
    expect(text).not.toContain('[Sam]: 0 ');
    expect(out.messages.length).toBeGreaterThan(0);
  });
});

describe('cleanReply', () => {
  it('strips an echoed own-name prefix only at the start', () => {
    expect(cleanReply('[Alpha]: hello', 'Alpha')).toBe('hello');
    expect(cleanReply('hello [Alpha]: x', 'Alpha')).toBe('hello [Alpha]: x');
    expect(cleanReply('[A.B]: hi', 'A.B')).toBe('hi');
  });
});

describe('buildMessages with modes and direct messages', () => {
  it('labels visible messages to one model, leader answers and fusions', () => {
    const history = [
      msg('user', 'Just for Beta', { target: 'b' }),
      msg('b', 'Beta here'),
      msg('c', 'Final call', { kind: 'leader' }),
      msg('a', 'Merged answer', { kind: 'fusion' }),
    ];
    const forC = buildMessages({ slot: c, config, history, username: 'Sam' });
    expect(forC.messages[0]!.content).toBe('[Sam, to Beta]: Just for Beta\n\n[Beta]: Beta here');
    expect(forC.messages[1]).toEqual({ role: 'assistant', content: 'Final call' });
    expect(forC.messages[2]!.content).toBe('[Alpha, fusing the answers]: Merged answer');
  });

  it('appends mode instructions after the roster', () => {
    const out = buildMessages({ slot: a, config, history: [], username: 'Sam', instructions: 'Lead now.' });
    expect(out.system.endsWith('Lead now.')).toBe(true);
    expect(out.system.indexOf('You are Alpha')).toBeLessThan(out.system.indexOf('Lead now.'));
  });
});

describe('shared context', () => {
  const ctx = (kind: ContextItem['kind'], title: string, extra: Partial<ContextItem> = {}): ContextItem => ({
    id: title,
    sessionId: 's',
    kind,
    title,
    text: `contents of ${title}`,
    tokens: 10,
    createdAt: 0,
    ...extra,
  });

  it('puts attachments in one leading user turn, merged with the first message', () => {
    const out = buildMessages({
      slot: a,
      config,
      history: [msg('user', 'What do these say?')],
      username: 'Sam',
      context: [ctx('file', 'notes.md'), ctx('youtube', 'A talk')],
    });
    expect(out.messages).toHaveLength(1);
    const text = out.messages[0]!.content as string;
    expect(text).toMatch(/^Shared context: material Sam attached/);
    expect(text).toContain('<document title="notes.md" kind="file">\ncontents of notes.md\n</document>');
    expect(text).toContain('<document title="A talk" kind="youtube">');
    expect(text.endsWith('[Sam]: What do these say?')).toBe(true);
  });

  it('sends images only to vision models, as image parts', () => {
    const image = ctx('image', 'chart.png', { text: '', mediaType: 'image/png', data: 'AAAA' });
    const history = [msg('user', 'Describe it')];
    const seeing = buildMessages({
      slot: a,
      config,
      history,
      username: 'Sam',
      context: [image],
      vision: true,
    });
    const parts = seeing.messages[0]!.content as ContentPart[];
    expect(parts.map((p) => p.type)).toEqual(['text', 'image', 'text']);
    expect(parts[1]).toEqual({ type: 'image', mediaType: 'image/png', data: 'AAAA' });
    expect((parts[2] as { text: string }).text).toBe('[Sam]: Describe it');

    const blind = buildMessages({ slot: a, config, history, username: 'Sam', context: [image] });
    expect(typeof blind.messages[0]!.content).toBe('string');
    expect(blind.messages[0]!.content).toContain("You can't view images");
  });

  it('escapes titles and never trims attachments when history is trimmed', () => {
    const big = ctx('file', 'a"<b>.txt', { text: 'x'.repeat(2000) });
    const history = Array.from({ length: 40 }, (_, i) =>
      msg(i % 2 ? 'b' : 'user', `${i} ${'y'.repeat(400)}`),
    );
    const out = buildMessages({
      slot: a,
      config,
      history,
      username: 'Sam',
      context: [big],
      contextLength: 4000,
    });
    expect(out.trimmed).toBe(true);
    const first = turnText(out.messages[0]!.content);
    expect(first).toContain('title="a&quot;&lt;b>.txt"');
    expect(first).toContain('x'.repeat(2000));
    expect(turnText(out.messages.at(-1)!.content)).toContain('39 ');
  });
});
