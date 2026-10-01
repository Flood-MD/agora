import fs from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import type { z } from 'zod';
import {
  createSessionSchema,
  customModelSchema,
  sendMessageSchema,
  updateSessionSchema,
  updateSettingsSchema,
  type SessionEvent,
} from '@agora/shared';
import type { AppConfig } from './config';
import { openDb } from './db';
import { EventBus } from './events';
import { BusyError, Orchestrator } from './orchestrator';
import { Providers } from './providers';
import { DEFAULT_TITLE, emptyConfig, SessionStore } from './sessions';
import { Settings } from './settings';

const HEARTBEAT_MS = 25_000;

async function parse<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S> | Response> {
  const body = await c.req.json().catch(() => undefined);
  const result = schema.safeParse(body ?? {});
  if (!result.success) return c.json({ error: 'Invalid request', issues: result.error.issues }, 400);
  return result.data;
}

export function createApp(config: AppConfig, dbFile = path.join(config.dataDir, 'agora.db')) {
  const db = openDb(dbFile);
  const settings = new Settings(db, config);
  const providers = new Providers(settings, config);
  const store = new SessionStore(db);
  const bus = new EventBus();
  const orchestrator = new Orchestrator(store, providers, settings, bus);
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

  api.get('/sessions', (c) => c.json(store.list(running)));

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
    return c.json({ session, messages: store.messages(id) });
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
      const message = orchestrator.send(session, input.text);
      return c.json({ message }, 202);
    } catch (err) {
      if (err instanceof BusyError) return c.json({ error: err.message }, 409);
      throw err;
    }
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
      push({ type: 'snapshot', detail: { session, messages: store.messages(id) } });
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
