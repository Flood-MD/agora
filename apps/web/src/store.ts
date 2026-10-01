import { create } from 'zustand';
import type {
  ContextItem,
  CustomModelInput,
  Message,
  ModelInfo,
  Session,
  SessionConfig,
  SessionEvent,
  SessionSummary,
  SettingsView,
  UpdateSettingsInput,
} from '@agora/shared';
import { api, ApiError, type Catalog } from './api';

const PREFS_KEY = 'agora.prefs';

interface Prefs {
  hideSlots: boolean;
  /** The `-` button: mode buttons collapsed into a `+`. */
  modesCollapsed: boolean;
  /** Messages to one model default to private. */
  privateDm: boolean;
  selfChatRounds: number;
}

const DEFAULT_PREFS: Prefs = { hideSlots: false, modesCollapsed: false, privateDm: false, selfChatRounds: 3 };

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface State {
  settings?: SettingsView;
  catalog: Catalog & { loading: boolean; loaded: boolean };
  sessions: SessionSummary[];
  session?: Session;
  messages: Message[];
  /** Attachments of the open chat. */
  context: ContextItem[];
  /** What is being attached right now (shown as a busy chip), if anything. */
  attaching?: string;
  /** Live feed connection state for the open session. */
  connected: boolean;
  /** Set when the open chat turns out to be deleted or missing, so the app can move elsewhere. */
  goneSessionId?: string;
  toast?: string;
  prefs: Prefs;

  setPrefs(patch: Partial<Prefs>): void;
  showToast(message?: string): void;
  loadSettings(): Promise<void>;
  saveSettings(input: UpdateSettingsInput): Promise<void>;
  loadCatalog(refresh?: boolean): Promise<void>;
  addCustomModel(input: CustomModelInput): Promise<ModelInfo>;
  removeCustomModel(id: string): Promise<void>;
  loadSessions(): Promise<void>;
  newSession(): Promise<string>;
  /** Load: creates a chat from a file written by Save and returns its id, or undefined on failure. */
  importSession(file: File): Promise<string | undefined>;
  clearTranscript(): Promise<void>;
  restoreTranscript(): Promise<void>;
  renameSession(id: string, title: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  updateConfig(mutate: (config: SessionConfig) => SessionConfig): void;
  send(text: string, opts?: { target?: string; private?: boolean }): Promise<boolean>;
  selfChat(rounds: number, topic?: string): Promise<boolean>;
  regenerate(): Promise<void>;
  /** Runs an attach action with a busy label and error toast; true on success. */
  attach(
    label: string,
    run: (sessionId: string) => Promise<{ items: ContextItem[]; skipped?: string[] }>,
  ): Promise<boolean>;
  removeContext(itemId: string): Promise<void>;
  stop(): Promise<void>;
  applyEvent(event: SessionEvent): void;
  setConnected(connected: boolean): void;
  markGone(id: string): void;
  clearSession(): void;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Config writes are queued so each one carries the `updatedAt` returned by the previous one. */
let configWrites: Promise<unknown> = Promise.resolve();

export const useStore = create<State>()((set, get) => ({
  catalog: { models: [], errors: {}, loading: false, loaded: false },
  sessions: [],
  messages: [],
  context: [],
  connected: false,
  prefs: loadPrefs(),

  setPrefs(patch) {
    const prefs = { ...get().prefs, ...patch };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Private mode or storage disabled: prefs just won't persist on this device.
    }
    set({ prefs });
  },

  showToast(toast) {
    set({ toast });
  },

  async loadSettings() {
    set({ settings: await api.settings() });
  },

  async saveSettings(input) {
    set({ settings: await api.saveSettings(input) });
    void get().loadCatalog(true);
  },

  async loadCatalog(refresh = false) {
    set((s) => ({ catalog: { ...s.catalog, loading: true } }));
    try {
      const catalog = await api.models(refresh);
      set({ catalog: { ...catalog, loading: false, loaded: true } });
    } catch (err) {
      set((s) => ({
        catalog: { ...s.catalog, loading: false },
        toast: `Could not load models: ${errorText(err)}`,
      }));
    }
  },

  async addCustomModel(input) {
    const model = await api.addCustomModel(input);
    await get().loadCatalog();
    return model;
  },

  async removeCustomModel(id) {
    try {
      await api.removeCustomModel(id);
      await get().loadCatalog();
    } catch (err) {
      set({ toast: `Could not remove model: ${errorText(err)}` });
    }
  },

  async loadSessions() {
    set({ sessions: await api.sessions() });
  },

  async newSession() {
    const session = await api.createSession();
    await get().loadSessions();
    return session.id;
  },

  async importSession(file) {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      set({ toast: `“${file.name}” is not a JSON file saved from Agora.` });
      return undefined;
    }
    try {
      const session = await api.importSession(data);
      await get().loadSessions();
      return session.id;
    } catch (err) {
      const invalid = err instanceof ApiError && err.status === 400;
      set({
        toast: invalid
          ? `“${file.name}” is not a chat saved from Agora.`
          : `Could not load: ${errorText(err)}`,
      });
      return undefined;
    }
  },

  async clearTranscript() {
    const session = get().session;
    if (session) await api.clear(session.id).catch((err) => set({ toast: errorText(err) }));
  },

  async restoreTranscript() {
    const session = get().session;
    if (session) await api.restore(session.id).catch((err) => set({ toast: errorText(err) }));
  },

  async renameSession(id, title) {
    const session = await api.updateSession(id, { title });
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, title: session.title } : x)),
      session: s.session?.id === id ? { ...s.session, title: session.title } : s.session,
    }));
  },

  async deleteSession(id) {
    await api.deleteSession(id);
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }));
  },

  updateConfig(mutate) {
    const current = get().session;
    if (!current) return;
    set({ session: { ...current, config: mutate(current.config) } });
    configWrites = configWrites.then(async () => {
      const session = get().session;
      if (!session || session.id !== current.id) return;
      try {
        const saved = await api.updateSession(session.id, {
          config: session.config,
          baseUpdatedAt: session.updatedAt,
        });
        set((s) => (s.session?.id === saved.id ? { session: { ...saved, config: s.session.config } } : {}));
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const latest = (err.body as { session?: Session }).session;
          if (latest) set({ session: latest });
          set({ toast: 'This chat was changed on another device — showing the latest version.' });
        } else {
          set({ toast: `Could not save: ${errorText(err)}` });
        }
      }
    });
  },

  async send(text, opts) {
    const session = get().session;
    if (!session) return false;
    try {
      await api.send(session.id, text, opts);
      return true;
    } catch (err) {
      set({ toast: errorText(err) });
      return false;
    }
  },

  async selfChat(rounds, topic) {
    const session = get().session;
    if (!session) return false;
    try {
      await api.selfChat(session.id, rounds, topic);
      return true;
    } catch (err) {
      set({ toast: errorText(err) });
      return false;
    }
  },

  async regenerate() {
    const session = get().session;
    if (session) await api.regenerate(session.id).catch((err) => set({ toast: errorText(err) }));
  },

  async attach(label, run) {
    const session = get().session;
    if (!session) return false;
    set({ attaching: label });
    try {
      const { skipped } = await run(session.id);
      if (skipped?.length) set({ toast: `Skipped: ${skipped.join(' ')}` });
      return true;
    } catch (err) {
      set({ toast: errorText(err) });
      return false;
    } finally {
      set({ attaching: undefined });
    }
  },

  async removeContext(itemId) {
    const session = get().session;
    if (session) await api.removeContext(session.id, itemId).catch((err) => set({ toast: errorText(err) }));
  },

  async stop() {
    const session = get().session;
    if (session) await api.stop(session.id).catch((err) => set({ toast: errorText(err) }));
  },

  applyEvent(event) {
    const { session } = get();
    switch (event.type) {
      case 'snapshot':
        set({
          session: event.detail.session,
          messages: event.detail.messages,
          context: event.detail.context,
        });
        break;
      case 'context':
        if (session?.id === event.sessionId) set({ context: event.items });
        break;
      case 'message': {
        if (session?.id !== event.message.sessionId) return;
        set((s) => {
          const messages = s.messages.slice();
          const i = messages.findLastIndex((m) => m.id === event.message.id);
          if (i >= 0) messages[i] = event.message;
          else messages.push(event.message);
          return { messages };
        });
        break;
      }
      case 'session': {
        const incoming = event.session;
        set((s) => ({
          session: s.session?.id === incoming.id ? incoming : s.session,
          sessions: s.sessions.some((x) => x.id === incoming.id)
            ? s.sessions.map((x) =>
                x.id === incoming.id
                  ? { ...x, title: incoming.title, updatedAt: incoming.updatedAt, running: incoming.running }
                  : x,
              )
            : s.sessions,
        }));
        break;
      }
      case 'deleted':
        set((s) => ({ sessions: s.sessions.filter((x) => x.id !== event.sessionId) }));
        if (session?.id === event.sessionId) get().markGone(event.sessionId);
        break;
    }
  },

  setConnected(connected) {
    set({ connected });
  },

  markGone(id) {
    set({ goneSessionId: id, session: undefined, messages: [] });
  },

  clearSession() {
    set({ session: undefined, messages: [], context: [], connected: false, goneSessionId: undefined });
  },
}));
