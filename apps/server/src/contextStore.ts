import { nanoid } from 'nanoid';
import { estimateTokens, IMAGE_TOKENS, type ContextItem } from '@agora/shared';
import type { Db } from './db';

interface Row {
  id: string;
  session_id: string;
  kind: ContextItem['kind'];
  title: string;
  text: string;
  media_type: string | null;
  data: string | null;
  tokens: number;
  note: string | null;
  created_at: number;
}

export type NewContextItem = Pick<ContextItem, 'kind' | 'title' | 'text'> &
  Partial<Pick<ContextItem, 'mediaType' | 'data' | 'note'>>;

const toItem = (r: Row): ContextItem => ({
  id: r.id,
  sessionId: r.session_id,
  kind: r.kind,
  title: r.title,
  text: r.text,
  ...(r.media_type && { mediaType: r.media_type }),
  ...(r.data && { data: r.data }),
  tokens: r.tokens,
  ...(r.note && { note: r.note }),
  createdAt: r.created_at,
});

/** Attachments per chat, in the order they were added. */
export class ContextStore {
  constructor(private db: Db) {}

  list(sessionId: string): ContextItem[] {
    const rows = this.db
      .prepare('SELECT * FROM context_items WHERE session_id = ? ORDER BY created_at, rowid')
      .all(sessionId) as unknown as Row[];
    return rows.map(toItem);
  }

  add(sessionId: string, item: NewContextItem): ContextItem {
    const id = nanoid(12);
    const tokens = item.kind === 'image' ? IMAGE_TOKENS : estimateTokens(item.text);
    this.db
      .prepare(
        `INSERT INTO context_items (id, session_id, kind, title, text, media_type, data, tokens, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        sessionId,
        item.kind,
        item.title,
        item.text,
        item.mediaType ?? null,
        item.data ?? null,
        tokens,
        item.note ?? null,
        Date.now(),
      );
    return toItem(this.db.prepare('SELECT * FROM context_items WHERE id = ?').get(id) as unknown as Row);
  }

  remove(sessionId: string, id: string): boolean {
    return (
      Number(
        this.db.prepare('DELETE FROM context_items WHERE id = ? AND session_id = ?').run(id, sessionId)
          .changes,
      ) > 0
    );
  }
}
