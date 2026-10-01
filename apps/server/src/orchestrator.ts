import {
  activeSlots,
  buildMessages,
  cleanReply,
  modeInstructions,
  planRound,
  planSelfChatRound,
  slotDisplayName,
  splitModelId,
  type Message,
  type MessageKind,
  type Session,
  type SessionConfig,
  type Slot,
  type Step,
} from '@agora/shared';
import type { ContextStore } from './contextStore';
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

/** A request that can't be carried out as asked (shown to the user as a 400/409). */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400,
  ) {
    super(message);
  }
}

/** One round to run. Steps are planned when the round starts, from the config at that moment. */
interface RoundPlan {
  round: number;
  /** `'all'`, or the slot id a private exchange belongs to. */
  audience: string;
  steps: (config: SessionConfig) => Step[];
}

export interface SendOptions {
  /** Send to one slot only. */
  target?: string;
  /** With a target: only that slot sees the message and its reply. */
  private?: boolean;
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
    private context: ContextStore,
  ) {}

  isRunning(sessionId: string): boolean {
    return this.runs.has(sessionId);
  }

  stop(sessionId: string): boolean {
    const run = this.runs.get(sessionId);
    run?.abort();
    return Boolean(run);
  }

  /**
   * Records the user's message and starts its round in the background: the whole group (with
   * Leader or Fusion if on), or one slot when `target` is set.
   */
  send(session: Session, text: string, opts: SendOptions = {}): Message {
    if (this.isRunning(session.id)) throw new BusyError();
    const { target } = opts;
    if (opts.private && !target) throw new RequestError('A private message needs a recipient.');
    if (target && !activeSlots(session.config).some((s) => s.id === target)) {
      throw new RequestError('That model is no longer in this chat.');
    }
    const audience = opts.private && target ? target : 'all';
    const round = this.store.lastRound(session.id) + 1;
    const message = this.addUserMessage(session.id, { round, text, audience, target });
    void this.run(session.id, [{ round, audience, steps: (config) => planRound(config, target) }]);
    return message;
  }

  /**
   * Self-Chat: the models talk among themselves for a number of rounds, one at a time in slot order.
   * An optional topic is posted first as the user's message.
   */
  selfChat(session: Session, rounds: number, topic?: string): Message | undefined {
    if (this.isRunning(session.id)) throw new BusyError();
    if (!activeSlots(session.config).length) throw new RequestError('Add at least one model first.');
    const first = this.store.lastRound(session.id) + 1;
    const message = topic
      ? this.addUserMessage(session.id, { round: first, text: topic, audience: 'all' })
      : undefined;
    void this.run(
      session.id,
      Array.from({ length: rounds }, (_, i) => ({
        round: first + i,
        audience: 'all',
        steps: planSelfChatRound,
      })),
    );
    return message;
  }

  /** Discards the model replies of the last round and runs that round again. */
  regenerate(session: Session) {
    if (this.isRunning(session.id)) throw new BusyError();
    const visible = this.store.messages(session.id);
    const last = visible.at(-1);
    if (!last) throw new RequestError('There is nothing to regenerate yet.', 409);
    const inRound = visible.filter((m) => m.round === last.round);
    const user = inRound.find((m) => m.author === 'user');
    this.store.deleteMessages(inRound.filter((m) => m.author !== 'user').map((m) => m.id));
    this.bus.emit(session.id, {
      type: 'snapshot',
      detail: {
        session: this.store.get(session.id, true)!,
        messages: this.store.messages(session.id),
        context: this.context.list(session.id),
      },
    });
    void this.run(session.id, [
      user
        ? { round: last.round, audience: user.audience, steps: (config) => planRound(config, user.target) }
        : { round: last.round, audience: 'all', steps: planSelfChatRound },
    ]);
  }

  private addUserMessage(
    sessionId: string,
    m: { round: number; text: string; audience: string; target?: string },
  ): Message {
    const message = this.store.addMessage(sessionId, {
      ...m,
      author: 'user',
      authorName: this.settings.username(),
      status: 'done',
    });
    this.store.touch(sessionId);
    this.bus.emit(sessionId, { type: 'message', message });
    return message;
  }

  /**
   * Runs rounds in order. Within a round each step is a set of slots answering in parallel;
   * every step sees the transcript including the previous steps' answers.
   */
  private async run(sessionId: string, rounds: RoundPlan[]) {
    const controller = new AbortController();
    this.runs.set(sessionId, controller);
    this.emitSession(sessionId);
    // Load model catalogues (cached for hours) so context windows and image support are known.
    await this.providers.catalog().catch(() => undefined);
    try {
      for (const plan of rounds) {
        const initial = this.store.get(sessionId);
        if (!initial) break;
        for (const step of plan.steps(initial.config)) {
          if (controller.signal.aborted) return;
          // Re-read so Roles edits and removed slots apply from the next step on.
          const session = this.store.get(sessionId);
          if (!session) return;
          const slots = step.slotIds
            .map((id) => session.config.slots.find((s) => s.id === id))
            .filter((s): s is Slot => Boolean(s?.model));
          const history = this.store.messages(sessionId);
          await Promise.all(
            slots.map((slot) =>
              this.runSlot(session, slot, plan.round, history, controller.signal, plan.audience, step.kind),
            ),
          );
        }
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
    audience: string,
    kind?: MessageKind,
  ) {
    const name = slotDisplayName(slot);
    const message = this.store.addMessage(session.id, {
      round,
      author: slot.id,
      authorName: name,
      model: slot.model!,
      text: '',
      status: 'streaming',
      audience,
      kind,
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
      const username = this.settings.username();
      const prompt = buildMessages({
        slot,
        config: session.config,
        history,
        username,
        instructions: modeInstructions(kind, username),
        context: this.context.list(session.id),
        vision: this.providers.supportsVision(slot.model!),
        contextLength: info?.contextLength,
        reserveForOutput: Math.min(info?.maxOutput ?? 4096, 8192),
      });
      const stream = this.providers.get(provider).stream(
        {
          model,
          system: prompt.system,
          messages: prompt.messages,
          maxTokens: info?.maxOutput,
          webSearch: session.config.webSearch,
        },
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
