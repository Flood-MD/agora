import {
  buildMessages,
  cleanReply,
  slotDisplayName,
  splitModelId,
  type Message,
  type Session,
  type Slot,
} from '@agora/shared';
import type { EventBus } from './events';
import type { Providers } from './providers';
import type { SessionStore } from './sessions';
import type { Settings } from './settings';

/** How often streaming text is pushed to clients / written to SQLite. */
const EMIT_INTERVAL_MS = 50;
const PERSIST_INTERVAL_MS = 500;

export class BusyError extends Error {
  constructor() {
    super('A response is already being generated in this chat. Stop it or wait for it to finish.');
  }
}

/**
 * Runs rounds on the server, so a generation continues when a tab closes or a phone sleeps,
 * and every device watching the session sees the same stream.
 */
export class Orchestrator {
  private runs = new Map<string, AbortController>();

  constructor(
    private store: SessionStore,
    private providers: Providers,
    private settings: Settings,
    private bus: EventBus,
  ) {}

  isRunning(sessionId: string): boolean {
    return this.runs.has(sessionId);
  }

  stop(sessionId: string): boolean {
    const run = this.runs.get(sessionId);
    run?.abort();
    return Boolean(run);
  }

  /** Records the user's message and starts a group round in the background. */
  send(session: Session, text: string): Message {
    if (this.isRunning(session.id)) throw new BusyError();
    const round = this.store.lastRound(session.id) + 1;
    const message = this.store.addMessage(session.id, {
      round,
      author: 'user',
      authorName: this.settings.username(),
      text,
      status: 'done',
      audience: 'all',
    });
    this.store.touch(session.id);
    this.bus.emit(session.id, { type: 'message', message });

    const slots = session.config.slots.filter((s) => s.model);
    if (slots.length) void this.run(session.id, round, [slots]);
    return message;
  }

  /**
   * Runs a plan: a list of steps, each a set of slots answering in parallel.
   * Every step sees the transcript including the previous steps' answers.
   */
  private async run(sessionId: string, round: number, steps: Slot[][]) {
    const controller = new AbortController();
    this.runs.set(sessionId, controller);
    this.emitSession(sessionId);
    try {
      for (const step of steps) {
        if (controller.signal.aborted) break;
        const session = this.store.get(sessionId);
        if (!session) break;
        const history = this.store.messages(sessionId);
        await Promise.all(step.map((slot) => this.runSlot(session, slot, round, history, controller.signal)));
      }
    } finally {
      this.runs.delete(sessionId);
      this.emitSession(sessionId);
    }
  }

  private async runSlot(
    session: Session,
    slot: Slot,
    round: number,
    history: Message[],
    signal: AbortSignal,
  ) {
    const name = slotDisplayName(slot);
    const message = this.store.addMessage(session.id, {
      round,
      author: slot.id,
      authorName: name,
      model: slot.model!,
      text: '',
      status: 'streaming',
      audience: 'all',
    });
    this.bus.emit(session.id, { type: 'message', message });

    const started = Date.now();
    let lastEmit = 0;
    let lastPersist = started;
    const flush = (force = false) => {
      const now = Date.now();
      if (force || now - lastEmit >= EMIT_INTERVAL_MS) {
        lastEmit = now;
        this.bus.emit(session.id, { type: 'message', message: { ...message } });
      }
      if (force || now - lastPersist >= PERSIST_INTERVAL_MS) {
        lastPersist = now;
        this.store.saveMessage(message);
      }
    };

    try {
      const { provider, model } = splitModelId(slot.model!);
      const info = this.providers.cachedModel(slot.model!);
      const prompt = buildMessages({
        slot,
        config: session.config,
        history,
        username: this.settings.username(),
        contextLength: info?.contextLength,
        reserveForOutput: Math.min(info?.maxOutput ?? 4096, 8192),
      });
      const stream = this.providers
        .get(provider)
        .stream(
          { model, system: prompt.system, messages: prompt.messages, maxTokens: info?.maxOutput },
          signal,
        );
      for await (const event of stream) {
        if (event.type === 'text') {
          message.text += event.text;
          flush();
        } else {
          message.usage = event.usage;
        }
      }
      message.status = signal.aborted ? 'stopped' : 'done';
    } catch (err) {
      if (signal.aborted) {
        message.status = 'stopped';
      } else {
        message.status = 'error';
        message.error = err instanceof Error ? err.message : String(err);
      }
    }
    message.text = cleanReply(message.text, name);
    message.latencyMs = Date.now() - started;
    flush(true);
  }

  private emitSession(sessionId: string) {
    const session = this.store.get(sessionId, this.isRunning(sessionId));
    if (session) this.bus.emit(sessionId, { type: 'session', session });
  }
}
