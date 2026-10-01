import { useCallback, useEffect, useState } from 'react';
import { Composer } from './components/Composer';
import { Header } from './components/Header';
import { SettingsModal } from './components/SettingsModal';
import { SlotBar } from './components/SlotBar';
import { Toast } from './components/Toast';
import { Transcript } from './components/Transcript';
import { useStore } from './store';
import { useSessionFeed } from './useSessionFeed';

/** The open chat lives in the URL (`#/c/<id>`) so each device can bookmark or share a link to it. */
function idFromHash(): string | undefined {
  return location.hash.match(/^#\/c\/([\w-]+)/)?.[1];
}

export function App() {
  const [sessionId, setSessionId] = useState(idFromHash);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const goneSessionId = useStore((s) => s.goneSessionId);
  const hideSlots = useStore((s) => s.prefs.hideSlots);
  // A chat deleted here or on another device (or a stale link) counts as no chat.
  const activeId = sessionId !== goneSessionId ? sessionId : undefined;
  const { loadSettings, loadSessions, newSession, clearSession, showToast } = useStore.getState();

  const open = useCallback((id: string) => {
    location.hash = `#/c/${id}`;
  }, []);

  const createAndOpen = useCallback(async () => {
    try {
      open(await newSession());
    } catch (err) {
      showToast(`Could not create chat: ${err instanceof Error ? err.message : err}`);
    }
  }, [newSession, open, showToast]);

  useEffect(() => {
    const onHash = () => setSessionId(idFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // No chat in the URL (first visit, or the open one is gone): open the latest, or start one.
  useEffect(() => {
    if (activeId) return;
    void (async () => {
      try {
        await Promise.all([loadSettings(), loadSessions()]);
        const latest = useStore.getState().sessions[0];
        if (latest) open(latest.id);
        else await createAndOpen();
      } catch (err) {
        showToast(`Cannot reach the Agora server: ${err instanceof Error ? err.message : err}`);
      }
    })();
  }, [activeId, loadSettings, loadSessions, open, createAndOpen, showToast]);

  useEffect(() => {
    void loadSettings().catch(() => undefined);
  }, [loadSettings]);

  // Switching chats: drop the old one's state until the new snapshot arrives.
  useEffect(() => clearSession(), [sessionId, clearSession]);

  useSessionFeed(activeId);

  return (
    <div className="flex h-dvh flex-col">
      <Header
        onOpenSession={open}
        onNewSession={() => void createAndOpen()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className={hideSlots ? 'hidden' : 'pt-3'}>
        <SlotBar />
      </div>
      <Transcript />
      <Composer />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <Toast />
    </div>
  );
}
