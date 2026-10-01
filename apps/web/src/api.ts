import type {
  CustomModelInput,
  Message,
  ModelInfo,
  ProviderId,
  Session,
  SessionConfig,
  SessionDetail,
  SessionSummary,
  SettingsView,
  UpdateSettingsInput,
} from '@agora/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError((body as { error?: string })?.error ?? res.statusText, res.status, body);
  return body as T;
}

export interface Catalog {
  models: ModelInfo[];
  errors: Partial<Record<ProviderId, string>>;
}

export const api = {
  settings: () => request<SettingsView>('/settings'),
  saveSettings: (input: UpdateSettingsInput) =>
    request<SettingsView>('/settings', { method: 'PUT', json: input }),
  models: (refresh = false) => request<Catalog>(`/models${refresh ? '?refresh=1' : ''}`),
  addCustomModel: (input: CustomModelInput) =>
    request<ModelInfo>('/models/custom', { method: 'POST', json: input }),
  removeCustomModel: (id: string) =>
    request<void>(`/models/custom?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  sessions: (query = '') =>
    request<SessionSummary[]>(`/sessions${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`),
  importSession: (data: unknown) => request<Session>('/sessions/import', { method: 'POST', json: data }),
  exportUrl: (id: string) => `/api/sessions/${id}/export`,
  clear: (id: string) => request<Session>(`/sessions/${id}/clear`, { method: 'POST' }),
  restore: (id: string) => request<Session>(`/sessions/${id}/restore`, { method: 'POST' }),
  session: (id: string) => request<SessionDetail>(`/sessions/${id}`),
  createSession: () => request<Session>('/sessions', { method: 'POST', json: {} }),
  updateSession: (id: string, patch: { title?: string; config?: SessionConfig; baseUpdatedAt?: number }) =>
    request<Session>(`/sessions/${id}`, { method: 'PATCH', json: patch }),
  deleteSession: (id: string) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
  send: (id: string, text: string, opts: { target?: string; private?: boolean } = {}) =>
    request<{ message: Message }>(`/sessions/${id}/messages`, { method: 'POST', json: { text, ...opts } }),
  selfChat: (id: string, rounds: number, topic?: string) =>
    request<{ message: Message | null }>(`/sessions/${id}/self-chat`, {
      method: 'POST',
      json: { rounds, topic },
    }),
  regenerate: (id: string) => request<void>(`/sessions/${id}/regenerate`, { method: 'POST' }),
  stop: (id: string) => request<{ stopped: boolean }>(`/sessions/${id}/stop`, { method: 'POST' }),
  eventsUrl: (id: string) => `/api/sessions/${id}/events`,
};
