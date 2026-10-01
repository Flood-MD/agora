import { create } from 'zustand';
import type {
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
}

function loadPrefs(): Prefs {
  try {
    return { hideSlots: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { hideSlots: false };
  }
}

interface State {
  settings?: SettingsView;
  catalog: Catalog & { loading: boolean; loaded: boolean };
  sessions: SessionSummary[];
  session?: Session;
  messages: Message[];
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
  renameSession(id: string, title: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  updateConfig(mutate: (config: SessionConfig) => SessionConfig): void;
  send(text: string): Promise<boolean>;
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

  async send(text) {
    const session = get().session;
    if (!session) return false;
    try {
      await api.send(session.id, text);
      return true;
    } catch (err) {
      set({ toast: errorText(err) });
      return false;
    }
  },

  async stop() {
    const session = get().session;
    if (session) await api.stop(session.id).catch((err) => set({ toast: errorText(err) }));
  },

  applyEvent(event) {
    const { session } = get();
    switch (event.type) {
      case 'snapshot':
        set({ session: event.detail.session, messages: event.detail.messages });
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
    set({ session: undefined, messages: [], connected: false, goneSessionId: undefined });
  },
}));
