import fs from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import type { z } from 'zod';
import {
  createSessionSchema,
  customModelSchema,
  selfChatSchema,
  applyCast,
  applyCastSchema,
  activeSlots,
  createPresetSchema,
  roleplaySchema,
  sendMessageSchema,
  sessionExportSchema,
  githubImportSchema,
  youtubeImportSchema,
  updateSessionSchema,
  updateSettingsSchema,
  type Cast,
  type SessionEvent,
} from '@agora/shared';
import type { AppConfig } from './config';
import { openDb } from './db';
import { EventBus } from './events';
import { BusyError, Orchestrator, RequestError } from './orchestrator';
import { Providers } from './providers';
import { DEFAULT_TITLE, emptyConfig, SessionStore } from './sessions';
import { Settings } from './settings';
import { Presets } from './presets';
import { generateCast } from './roleplay';
import { nanoid } from 'nanoid';
import { ContextStore, type NewContextItem } from './contextStore';
import { extractFile, extractFolder, IngestError } from './ingest/files';
import { importGithub } from './ingest/github';
import { transcribe } from './ingest/transcribe';
import { importYoutube } from './ingest/youtube';

const HEARTBEAT_MS = 25_000;

async function parse<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S> | Response> {
  const body = await c.req.json().catch(() => undefined);
  const result = schema.safeParse(body ?? {});
  if (!result.success) return c.json({ error: 'Invalid request', issues: result.error.issues }, 400);
  return result.data;
}

function orchestratorError(c: Context, err: unknown) {
  if (err instanceof BusyError) return c.json({ error: err.message }, 409);
  if (err instanceof RequestError) return c.json({ error: err.message }, err.status);
  throw err;
}

export function createApp(config: AppConfig, dbFile = path.join(config.dataDir, 'agora.db')) {
  const db = openDb(dbFile);
  const settings = new Settings(db, config);
  const providers = new Providers(settings, config);
  const store = new SessionStore(db);
  const bus = new EventBus();
  const context = new ContextStore(db);
  const presets = new Presets(db);
  const orchestrator = new Orchestrator(store, providers, settings, bus, context);
  const detail = (id: string) => ({
    session: store.get(id, running(id))!,
    messages: store.messages(id),
    context: context.list(id),
  });
  const running = (id: string) => orchestrator.isRunning(id);

  const app = new Hono();
  const api = new Hono();

  api.onError((err, c) => {
    console.error(err);
    return c.json({ error: err.message || 'Internal error' }, 500);
  });

  api.get('/health', (c) => c.json({ ok: true }));

  api.get('/settings', (c) => c.json(settings.view()));

  api.put('/settings', async (c) => {
    const input = await parse(c, updateSettingsSchema);
    if (input instanceof Response) return input;
    providers.invalidate(settings.update(input));
    return c.json(settings.view());
  });

  api.get('/models', async (c) => c.json(await providers.catalog(c.req.query('refresh') === '1')));

  api.post('/models/custom', async (c) => {
    const input = await parse(c, customModelSchema);
    if (input instanceof Response) return input;
    return c.json(settings.addCustomModel(input), 201);
  });

  // The model id contains slashes, so it travels as a query parameter.
  api.delete('/models/custom', (c) => {
    const id = c.req.query('id');
    if (!id || !settings.removeCustomModel(id)) return c.json({ error: 'Not found' }, 404);
    return c.body(null, 204);
  });

  // Saved role setups (Roles ▸ Rapid Roleplay).
  api.get('/presets', (c) => c.json(presets.list()));

  api.post('/presets', async (c) => {
    const input = await parse(c, createPresetSchema);
    if (input instanceof Response) return input;
    return c.json(presets.create(input.name, input.cast), 201);
  });

  api.delete('/presets/:presetId', (c) => {
    const preset = presets.get(c.req.param('presetId'));
    if (!preset) return c.json({ error: 'Not found' }, 404);
    if (preset.builtIn) return c.json({ error: 'Built-in setups can’t be deleted.' }, 400);
    presets.remove(preset.id);
    return c.body(null, 204);
  });

  /** Writes a cast into a chat (re-reading the config first) and tells every device. */
  const castInto = (id: string, cast: Cast, allowOverwrite: boolean) => {
    const current = store.get(id)!;
    const session = store.update(id, {
      config: applyCast(current.config, cast, allowOverwrite, () => nanoid(8)),
    })!;
    session.running = running(id);
    bus.emit(id, { type: 'session', session });
    return session;
  };

  api.post('/sessions/:id/cast', async (c) => {
    const id = c.req.param('id');
    const input = await parse(c, applyCastSchema);
    if (input instanceof Response) return input;
    if (!store.get(id)) return c.json({ error: 'Not found' }, 404);
    return c.json(castInto(id, input.cast, input.allowOverwrite));
  });

  // Rapid Roleplay: slot 1's model writes a cast for the scenario, which is applied to the chat.
  api.post('/sessions/:id/roleplay', async (c) => {
    const id = c.req.param('id');
    const input = await parse(c, roleplaySchema);
    if (input instanceof Response) return input;
    const session = store.get(id);
    if (!session) return c.json({ error: 'Not found' }, 404);
    const slots = activeSlots(session.config);
    if (!slots.length) return c.json({ error: 'Add a model first: slot 1’s model writes the roles.' }, 400);
    try {
      const cast = await generateCast(
        providers,
        slots[0]!,
        input.scenario,
        settings.username(),
        input.allowOverwrite ? undefined : slots.length,
      );
      return c.json({ cast, session: castInto(id, cast, input.allowOverwrite) });
    } catch (err) {
      if (err instanceof RequestError) return c.json({ error: err.message }, err.status);
      return c.json(
        { error: `Roleplay generation failed: ${err instanceof Error ? err.message : err}` },
        502,
      );
    }
  });

  api.get('/sessions', (c) => c.json(store.list(running, c.req.query('q') ?? '')));

  // Load: a file written by Save becomes a new chat.
  api.post('/sessions/import', async (c) => {
    const input = await parse(c, sessionExportSchema);
    if (input instanceof Response) return input;
    const session = store.import(input);
    for (const item of input.context ?? []) context.add(session.id, item);
    return c.json(session, 201);
  });

  api.post('/sessions', async (c) => {
    const input = await parse(c, createSessionSchema);
    if (input instanceof Response) return input;
    const session = store.create(
      input.title ?? DEFAULT_TITLE,
      input.config ?? store.latestConfig() ?? emptyConfig(),
    );
    return c.json(session, 201);
  });

  api.get('/sessions/:id', (c) => {
    const id = c.req.param('id');
    const session = store.get(id, running(id));
    if (!session) return c.json({ error: 'Not found' }, 404);
    return c.json({ ...detail(id), session });
  });

  api.patch('/sessions/:id', async (c) => {
    const id = c.req.param('id');
    const input = await parse(c, updateSessionSchema);
    if (input instanceof Response) return input;
    const current = store.get(id, running(id));
    if (!current) return c.json({ error: 'Not found' }, 404);
    if (input.baseUpdatedAt !== undefined && input.baseUpdatedAt !== current.updatedAt) {
      return c.json({ error: 'This chat was changed on another device.', session: current }, 409);
    }
    const session = store.update(id, input)!;
    session.running = running(id);
    bus.emit(id, { type: 'session', session });
    return c.json(session);
  });

  api.delete('/sessions/:id', (c) => {
    const id = c.req.param('id');
    orchestrator.stop(id);
    if (!store.delete(id)) return c.json({ error: 'Not found' }, 404);
    bus.emit(id, { type: 'deleted', sessionId: id });
    return c.body(null, 204);
  });

  api.post('/sessions/:id/messages', async (c) => {
    const id = c.req.param('id');
    const input = await parse(c, sendMessageSchema);
    if (input instanceof Response) return input;
    let session = store.get(id);
    if (!session) return c.json({ error: 'Not found' }, 404);
    if (session.title === DEFAULT_TITLE && store.lastRound(id) === 0) {
      const title =
        input.text
          .replace(/[*_`#>~]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 60)
          .trim() || DEFAULT_TITLE;
      session = store.update(id, { title })!;
    }
    try {
      const message = orchestrator.send(session, input.text, {
        target: input.target,
        private: input.private,
      });
      return c.json({ message }, 202);
    } catch (err) {
      return orchestratorError(c, err);
    }
  });

  api.post('/sessions/:id/self-chat', async (c) => {
    const id = c.req.param('id');
    const input = await parse(c, selfChatSchema);
    if (input instanceof Response) return input;
    const session = store.get(id);
    if (!session) return c.json({ error: 'Not found' }, 404);
    try {
      const message = orchestrator.selfChat(session, input.rounds, input.topic || undefined);
      return c.json({ message: message ?? null }, 202);
    } catch (err) {
      return orchestratorError(c, err);
    }
  });

  api.post('/sessions/:id/regenerate', (c) => {
    const session = store.get(c.req.param('id'));
    if (!session) return c.json({ error: 'Not found' }, 404);
    try {
      orchestrator.regenerate(session);
      return c.body(null, 202);
    } catch (err) {
      return orchestratorError(c, err);
    }
  });

  // Save: the chat as a downloadable JSON file.
  api.get('/sessions/:id/export', (c) => {
    const id = c.req.param('id');
    const exported = store.export(id);
    const data = exported && {
      ...exported,
      context: context.list(id).map(({ kind, title, text, mediaType, data, note }) => ({
        kind,
        title,
        text,
        ...(mediaType && { mediaType }),
        ...(data && { data }),
        ...(note && { note }),
      })),
    };
    if (!data) return c.json({ error: 'Not found' }, 404);
    const slug =
      data.title
        .replace(/[^\w-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'chat';
    const date = new Date(data.exportedAt).toISOString().slice(0, 10);
    c.header('Content-Disposition', `attachment; filename="agora-${slug}-${date}.json"`);
    return c.json(data);
  });

  const resync = (id: string) => {
    const session = store.get(id, running(id))!;
    bus.emit(id, { type: 'snapshot', detail: { ...detail(id), session } });
    return session;
  };

  api.post('/sessions/:id/clear', (c) => {
    const id = c.req.param('id');
    if (!store.get(id)) return c.json({ error: 'Not found' }, 404);
    if (running(id)) return c.json({ error: 'Stop the current responses before clearing.' }, 409);
    store.clear(id);
    return c.json(resync(id));
  });

  api.post('/sessions/:id/restore', (c) => {
    const id = c.req.param('id');
    if (!store.get(id)) return c.json({ error: 'Not found' }, 404);
    if (running(id)) return c.json({ error: 'Stop the current responses before restoring.' }, 409);
    if (!store.restore(id)) return c.json({ error: 'Nothing to restore.' }, 409);
    return c.json(resync(id));
  });

  // Attachments: every model in the chat sees them, ahead of the conversation.
  const contextChanged = (id: string) =>
    bus.emit(id, { type: 'context', sessionId: id, items: context.list(id) });

  const ingest = async (c: Context, id: string, make: () => Promise<NewContextItem[]>) => {
    if (!store.get(id)) return c.json({ error: 'Not found' }, 404);
    try {
      const items = (await make()).map((item) => context.add(id, item));
      contextChanged(id);
      return c.json({ items }, 201);
    } catch (err) {
      if (err instanceof IngestError) return c.json({ error: err.message }, 400);
      console.error(err);
      return c.json({ error: `Could not import: ${err instanceof Error ? err.message : err}` }, 502);
    }
  };

  const uploadLimit = bodyLimit({
    maxSize: 100 * 1024 * 1024,
    onError: (c) => c.json({ error: 'Upload is larger than 100 MB.' }, 413),
  });

  // Files, or a whole folder (with `folder` set to its name and file names as relative paths).
  api.post('/sessions/:id/context/files', uploadLimit, async (c) => {
    const id = c.req.param('id');
    const form = await c.req.parseBody({ all: true });
    const files = ([] as unknown[]).concat(form.files ?? []).filter((f): f is File => f instanceof File);
    if (!files.length) return c.json({ error: 'No files received.' }, 400);
    const folder = typeof form.folder === 'string' ? form.folder.trim() : '';
    const read = async (f: File) => ({ name: f.name, buf: Buffer.from(await f.arrayBuffer()) });
    const skipped: string[] = [];
    const res = await ingest(c, id, async () => {
      if (folder) return [await extractFolder(folder, await Promise.all(files.map(read)))];
      const items: NewContextItem[] = [];
      for (const f of files) {
        try {
          const { name, buf } = await read(f);
          items.push(await extractFile(name, buf));
        } catch (err) {
          if (!(err instanceof IngestError) || files.length === 1) throw err;
          skipped.push(err.message);
        }
      }
      return items;
    });
    if (res.status !== 201 || !skipped.length) return res;
    return c.json({ ...((await res.json()) as object), skipped }, 201);
  });

  api.post('/sessions/:id/context/github', async (c) => {
    const input = await parse(c, githubImportSchema);
    if (input instanceof Response) return input;
    return ingest(c, c.req.param('id'), async () => [await importGithub(input.repo, settings.key('github'))]);
  });

  api.post('/sessions/:id/context/youtube', async (c) => {
    const input = await parse(c, youtubeImportSchema);
    if (input instanceof Response) return input;
    return ingest(c, c.req.param('id'), async () => [await importYoutube(input.url)]);
  });

  api.post('/sessions/:id/context/transcribe', uploadLimit, async (c) => {
    const form = await c.req.parseBody();
    const audio = form.audio;
    if (!(audio instanceof File)) return c.json({ error: 'No audio received.' }, 400);
    return ingest(c, c.req.param('id'), async () => {
      const text = await transcribe(audio.name, audio.type, Buffer.from(await audio.arrayBuffer()), {
        openai: settings.key('openai'),
        huggingface: settings.key('huggingface'),
        mock: config.mock,
      });
      if (!text) throw new IngestError('No speech was recognised in that recording.');
      return [{ kind: 'transcript', title: `Transcript: ${audio.name}`, text }];
    });
  });

  api.delete('/sessions/:id/context/:itemId', (c) => {
    const id = c.req.param('id');
    if (!context.remove(id, c.req.param('itemId'))) return c.json({ error: 'Not found' }, 404);
    contextChanged(id);
    return c.body(null, 204);
  });

  api.post('/sessions/:id/stop', (c) => c.json({ stopped: orchestrator.stop(c.req.param('id')) }));

  // Live feed: a full snapshot first (so reconnects never miss anything), then incremental events.
  api.get('/sessions/:id/events', (c) => {
    const id = c.req.param('id');
    const session = store.get(id, running(id));
    if (!session) return c.json({ error: 'Not found' }, 404);
    return streamSSE(c, async (stream) => {
      const queue: SessionEvent[] = [];
      let wake: (() => void) | undefined;
      const push = (event: SessionEvent) => {
        queue.push(event);
        wake?.();
      };
      const unsubscribe = bus.subscribe(id, push);
      push({ type: 'snapshot', detail: { ...detail(id), session } });
      const heartbeat = setInterval(() => void stream.writeSSE({ event: 'ping', data: '' }), HEARTBEAT_MS);
      let closed = false;
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });
      try {
        while (!closed) {
          const event = queue.shift();
          if (event) {
            await stream.writeSSE({ data: JSON.stringify(event) });
            if (event.type === 'deleted') break;
          } else {
            await new Promise<void>((resolve) => (wake = resolve));
            wake = undefined;
          }
        }
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    });
  });

  app.route('/api', api);
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  if (config.webDist && fs.existsSync(config.webDist)) {
    const root = path.relative(process.cwd(), config.webDist);
    const index = fs.readFileSync(path.join(config.webDist, 'index.html'), 'utf8');
    app.use('/*', serveStatic({ root }));
    app.get('*', (c) => c.html(index));
  }

  return { app, db, orchestrator };
}
