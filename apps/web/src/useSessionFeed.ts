import { useEffect } from 'react';
import type { SessionEvent } from '@agora/shared';
import { api, ApiError } from './api';
import { useStore } from './store';

/**
 * Subscribes to a session's live feed. The server opens every connection with a full snapshot,
 * so EventSource's automatic reconnect (after sleep, Wi-Fi drop, server restart) resyncs fully.
 */
export function useSessionFeed(sessionId: string | undefined) {
  const applyEvent = useStore((s) => s.applyEvent);
  const setConnected = useStore((s) => s.setConnected);
  const markGone = useStore((s) => s.markGone);

  useEffect(() => {
    if (!sessionId) return;
    const source = new EventSource(api.eventsUrl(sessionId));
    source.onopen = () => setConnected(true);
    source.onerror = () => {
      setConnected(false);
      // EventSource retries forever; stop if the chat no longer exists (deleted, stale bookmark).
      api.session(sessionId).catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          source.close();
          markGone(sessionId);
        }
      });
    };
    source.onmessage = (e) => applyEvent(JSON.parse(e.data) as SessionEvent);
    return () => {
      source.close();
      setConnected(false);
    };
  }, [sessionId, applyEvent, setConnected, markGone]);
}
