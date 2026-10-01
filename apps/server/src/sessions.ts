import { nanoid } from 'nanoid';
import type { Message, Session, SessionConfig, SessionSummary } from '@agora/shared';
import type { Db } from './db';

interface SessionRow {
  id: string;
  title: string;
  config: string;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  seq: number;
  round: number;
  author: string;
  author_name: string;
  model: string | null;
  text: string;
  status: Message['status'];
  error: string | null;
  audience: string;
  usage: string | null;
  latency_ms: number | null;
  created_at: number;
}

export const DEFAULT_TITLE = 'New chat';

export function emptyConfig(): SessionConfig {
  return { slots: [], systemPrompt: '', showModelNames: false };
}

function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    sessionId: r.session_id,
    seq: r.seq,
    round: r.round,
    author: r.author,
    authorName: r.author_name,
    model: r.model ?? undefined,
    text: r.text,
    status: r.status,
    error: r.error ?? undefined,
    audience: r.audience,
    usage: r.usage ? JSON.parse(r.usage) : undefined,
    latencyMs: r.latency_ms ?? undefined,
    createdAt: r.created_at,
  };
}

export type NewMessage = Pick<Message, 'round' | 'author' | 'authorName' | 'text' | 'status' | 'audience'> &
  Partial<Pick<Message, 'model'>>;

/** Persistence for sessions and their transcripts. SQLite is the source of truth for every device. */
export class SessionStore {
  constructor(private db: Db) {
    // Anything still "streaming" was cut off by a restart.
    db.prepare(
      "UPDATE messages SET status = 'interrupted', error = 'Server restarted during generation' WHERE status = 'streaming'",
    ).run();
  }

  private row(id: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  }

  private toSession(r: SessionRow, running: boolean): Session {
    return {
      id: r.id,
      title: r.title,
      config: JSON.parse(r.config),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      running,
    };
  }

  get(id: string, running = false): Session | undefined {
    const r = this.row(id);
    return r && this.toSession(r, running);
  }

  list(isRunning: (id: string) => boolean): SessionSummary[] {
    const rows = this.db
      .prepare('SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC')
      .all() as unknown as Omit<SessionRow, 'config'>[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      running: isRunning(r.id),
    }));
  }

  /** The most recently used configuration, so a new chat starts with the same council. */
  latestConfig(): SessionConfig | undefined {
    const r = this.db.prepare('SELECT config FROM sessions ORDER BY updated_at DESC LIMIT 1').get() as
      { config: string } | undefined;
    return r && JSON.parse(r.config);
  }

  create(title: string, config: SessionConfig): Session {
    const now = Date.now();
    const id = nanoid(12);
    this.db
      .prepare('INSERT INTO sessions (id, title, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, title, JSON.stringify(config), now, now);
    return this.get(id)!;
  }

  update(id: string, patch: { title?: string; config?: SessionConfig }): Session | undefined {
    const current = this.row(id);
    if (!current) return undefined;
    this.db
      .prepare('UPDATE sessions SET title = ?, config = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.title ?? current.title,
        patch.config ? JSON.stringify(patch.config) : current.config,
        Math.max(Date.now(), current.updated_at + 1),
        id,
      );
    return this.get(id);
  }

  touch(id: string) {
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(Date.now(), id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id).changes > 0;
  }

  messages(sessionId: string): Message[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY seq')
      .all(sessionId) as unknown as MessageRow[];
    return rows.map(toMessage);
  }

  lastRound(sessionId: string): number {
    const r = this.db.prepare('SELECT MAX(round) AS r FROM messages WHERE session_id = ?').get(sessionId) as {
      r: number | null;
    };
    return r.r ?? 0;
  }

  addMessage(sessionId: string, m: NewMessage): Message {
    const id = nanoid(14);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO messages (id, session_id, seq, round, author, author_name, model, text, status, audience, created_at)
         VALUES (?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE session_id = ?), ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        sessionId,
        sessionId,
        m.round,
        m.author,
        m.authorName,
        m.model ?? null,
        m.text,
        m.status,
        m.audience,
        now,
      );
    return this.message(id)!;
  }

  message(id: string): Message | undefined {
    const r = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
    return r && toMessage(r);
  }

  saveMessage(m: Message) {
    this.db
      .prepare('UPDATE messages SET text = ?, status = ?, error = ?, usage = ?, latency_ms = ? WHERE id = ?')
      .run(
        m.text,
        m.status,
        m.error ?? null,
        m.usage ? JSON.stringify(m.usage) : null,
        m.latencyMs ?? null,
        m.id,
      );
  }
}
