import type { SessionEvent } from '@agora/shared';

type Listener = (event: SessionEvent) => void;

/** In-process pub/sub so every device watching a session gets the same live updates. */
export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) this.listeners.set(sessionId, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(sessionId);
    };
  }

  emit(sessionId: string, event: SessionEvent) {
    for (const listener of this.listeners.get(sessionId) ?? []) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not affect the others.
      }
    }
  }
}
