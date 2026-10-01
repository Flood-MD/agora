import { nanoid } from 'nanoid';
import {
  EXPORT_FORMAT,
  type Message,
  type Session,
  type SessionConfig,
  type SessionExport,
  type SessionSummary,
} from '@agora/shared';
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

const SNIPPET_RADIUS = 60;

/** Escapes LIKE wildcards so a search for "50%" or "a_b" matches literally. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function snippet(text: string, q: string): string {
  const flat = text.replace(/\s+/g, ' ');
  const i = flat.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return flat.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, i - SNIPPET_RADIUS);
  const end = Math.min(flat.length, i + q.length + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
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
      canRestore: this.canRestore(r.id),
    };
  }

  private canRestore(id: string): boolean {
    return Boolean(
      this.db.prepare('SELECT 1 FROM messages WHERE session_id = ? AND cleared = 1 LIMIT 1').get(id),
    );
  }

  get(id: string, running = false): Session | undefined {
    const r = this.row(id);
    return r && this.toSession(r, running);
  }

  /** Most recent first. With a query, only chats whose title or (visible) messages contain it. */
  list(isRunning: (id: string) => boolean, query = ''): SessionSummary[] {
    const q = query.trim();
    const count =
      '(SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id AND m.cleared = 0) AS message_count';
    type Row = Omit<SessionRow, 'config'> & { message_count: number };
    const rows = (q
      ? this.db
          .prepare(
            `SELECT s.id, s.title, s.created_at, s.updated_at, ${count} FROM sessions s
               WHERE s.title LIKE ?1 ESCAPE '\\'
                  OR EXISTS (SELECT 1 FROM messages m WHERE m.session_id = s.id AND m.cleared = 0
                             AND m.text LIKE ?1 ESCAPE '\\')
               ORDER BY s.updated_at DESC, s.rowid DESC`,
          )
          .all(likePattern(q))
      : this.db
          .prepare(
            `SELECT s.id, s.title, s.created_at, s.updated_at, ${count} FROM sessions s ORDER BY s.updated_at DESC, s.rowid DESC`,
          )
          .all()) as unknown as Row[];
    const firstMatch = this.db.prepare(
      `SELECT text FROM messages WHERE session_id = ? AND cleared = 0 AND text LIKE ? ESCAPE '\\' ORDER BY seq LIMIT 1`,
    );
    return rows.map((r) => {
      const summary: SessionSummary = {
        id: r.id,
        title: r.title,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        running: isRunning(r.id),
        messageCount: r.message_count,
      };
      if (q) {
        const hit = firstMatch.get(r.id, likePattern(q)) as { text: string } | undefined;
        if (hit) summary.match = snippet(hit.text, q);
      }
      return summary;
    });
  }

  /** The most recently used configuration, so a new chat starts with the same council. */
  latestConfig(): SessionConfig | undefined {
    const r = this.db
      .prepare('SELECT config FROM sessions ORDER BY updated_at DESC, rowid DESC LIMIT 1')
      .get() as { config: string } | undefined;
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
      .prepare('SELECT * FROM messages WHERE session_id = ? AND cleared = 0 ORDER BY seq')
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

  /**
   * Hides the visible transcript. Only the most recent clear can be restored, so anything cleared
   * earlier is deleted for good. Returns the number of messages cleared.
   */
  clear(sessionId: string): number {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM messages WHERE session_id = ? AND cleared = 1').run(sessionId);
      const { changes } = this.db
        .prepare('UPDATE messages SET cleared = 1 WHERE session_id = ? AND cleared = 0')
        .run(sessionId);
      this.db.exec('COMMIT');
      return Number(changes);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Brings back the last cleared transcript, in its original place before any newer messages. */
  restore(sessionId: string): number {
    const { changes } = this.db
      .prepare('UPDATE messages SET cleared = 0 WHERE session_id = ? AND cleared = 1')
      .run(sessionId);
    return Number(changes);
  }

  export(sessionId: string): SessionExport | undefined {
    const session = this.get(sessionId);
    if (!session) return undefined;
    return {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: Date.now(),
      title: session.title,
      config: session.config,
      messages: this.messages(sessionId).map((m) => ({
        round: m.round,
        author: m.author,
        authorName: m.authorName,
        ...(m.model && { model: m.model }),
        text: m.text,
        status: m.status,
        ...(m.error && { error: m.error }),
        audience: m.audience,
        ...(m.usage && { usage: m.usage }),
        ...(m.latencyMs !== undefined && { latencyMs: m.latencyMs }),
        createdAt: m.createdAt,
      })),
    };
  }

  /** Creates a new chat from an exported file. */
  import(data: SessionExport): Session {
    this.db.exec('BEGIN');
    try {
      const session = this.create(data.title, data.config);
      const insert = this.db.prepare(
        `INSERT INTO messages (id, session_id, seq, round, author, author_name, model, text, status, error,
                               audience, usage, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      data.messages.forEach((m, i) => {
        // A reply that was mid-stream when exported can't continue here.
        const status = m.status === 'streaming' ? 'interrupted' : m.status;
        insert.run(
          nanoid(14),
          session.id,
          i + 1,
          m.round,
          m.author,
          m.authorName,
          m.model ?? null,
          m.text,
          status,
          m.error ?? (m.status === 'streaming' ? 'Exported while still generating' : null),
          m.audience,
          m.usage ? JSON.stringify(m.usage) : null,
          m.latencyMs ?? null,
          m.createdAt,
        );
      });
      this.db.exec('COMMIT');
      return this.get(session.id)!;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
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
