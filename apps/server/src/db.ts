import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    config     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,
    round       INTEGER NOT NULL,
    author      TEXT NOT NULL,
    author_name TEXT NOT NULL,
    model       TEXT,
    text        TEXT NOT NULL,
    status      TEXT NOT NULL,
    error       TEXT,
    audience    TEXT NOT NULL,
    usage       TEXT,
    latency_ms  INTEGER,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX messages_session_seq ON messages(session_id, seq);
  `,
  // Clear hides messages instead of deleting them, so Restore can bring the last cleared transcript back.
  `ALTER TABLE messages ADD COLUMN cleared INTEGER NOT NULL DEFAULT 0;`,
  // Messages sent to one model (`target`) and how a reply was produced (`kind`: leader, fusion, self-chat).
  `ALTER TABLE messages ADD COLUMN target TEXT;
   ALTER TABLE messages ADD COLUMN kind TEXT;`,
  // Attachments (files, folders, repositories, transcripts, images) shared with every model in a chat.
  `CREATE TABLE context_items (
     id         TEXT PRIMARY KEY,
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     kind       TEXT NOT NULL,
     title      TEXT NOT NULL,
     text       TEXT NOT NULL,
     media_type TEXT,
     data       TEXT,
     tokens     INTEGER NOT NULL,
     note       TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX context_items_session ON context_items(session_id, created_at);`,
];

/** Opens (and migrates) the database. Pass `':memory:'` for tests. */
export function openDb(file: string): Db {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}
