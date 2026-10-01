import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { ChevronDownIcon, PencilIcon, PlusIcon, TrashIcon } from './icons';

export function Header({
  onOpenSession,
  onNewSession,
  onOpenSettings,
}: {
  onOpenSession: (id: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
}) {
  const session = useStore((s) => s.session);
  const connected = useStore((s) => s.connected);
  const username = useStore((s) => s.settings?.username ?? 'User');
  const hideSlots = useStore((s) => s.prefs.hideSlots);
  const setPrefs = useStore((s) => s.setPrefs);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="flex items-center gap-2 px-3 pt-3 sm:px-4">
      <div className="relative min-w-0 shrink">
        <button
          className="flex max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-lg font-bold hover:bg-panel-2"
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span className="truncate">{session?.title ?? 'Agora'}</span>
          <ChevronDownIcon className="shrink-0" />
        </button>
        {menuOpen && (
          <SessionMenu
            onClose={() => setMenuOpen(false)}
            onOpenSession={onOpenSession}
            onNewSession={onNewSession}
          />
        )}
      </div>
      <button className="btn px-2.5 py-1 text-xs" onClick={() => setPrefs({ hideSlots: !hideSlots })}>
        {hideSlots ? 'Show' : 'Hide'}
      </button>
      <span
        className={`size-2 shrink-0 rounded-full ${connected ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`}
        title={connected ? 'Live' : 'Reconnecting…'}
      />
      <div className="ml-auto flex items-center gap-2">
        <button
          className="btn size-9 p-0 font-bold"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
        >
          {username.trim().charAt(0).toUpperCase() || 'M'}
        </button>
      </div>
    </header>
  );
}

function SessionMenu({
  onClose,
  onOpenSession,
  onNewSession,
}: {
  onClose: () => void;
  onOpenSession: (id: string) => void;
  onNewSession: () => void;
}) {
  const sessions = useStore((s) => s.sessions);
  const current = useStore((s) => s.session?.id);
  const loadSessions = useStore((s) => s.loadSessions);
  const renameSession = useStore((s) => s.renameSession);
  const deleteSession = useStore((s) => s.deleteSession);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadSessions();
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [loadSessions, onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute left-0 top-full z-40 mt-1 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
    >
      <button
        className="flex w-full items-center gap-2 border-b border-line px-3 py-2.5 text-left text-sm font-medium hover:bg-panel-2"
        onClick={() => {
          onClose();
          onNewSession();
        }}
      >
        <PlusIcon /> New chat
      </button>
      <ul className="max-h-[60dvh] overflow-y-auto py-1">
        {sessions.map((s) => (
          <li key={s.id} className={`group flex items-center ${s.id === current ? 'bg-panel-2' : ''}`}>
            <button
              className="min-w-0 flex-1 px-3 py-2 text-left text-sm hover:bg-panel-2"
              onClick={() => {
                onClose();
                onOpenSession(s.id);
              }}
            >
              <span className="block truncate">{s.title}</span>
              <span className="text-xs text-muted">
                {new Date(s.updatedAt).toLocaleString()}
                {s.running && ' · responding…'}
              </span>
            </button>
            <button
              className="p-2 text-muted hover:text-white"
              title="Rename"
              aria-label={`Rename ${s.title}`}
              onClick={() => {
                const title = prompt('Rename chat', s.title)?.trim();
                if (title) void renameSession(s.id, title);
              }}
            >
              <PencilIcon size={14} />
            </button>
            <button
              className="p-2 pr-3 text-muted hover:text-red-400"
              title="Delete"
              aria-label={`Delete ${s.title}`}
              onClick={() => {
                if (confirm(`Delete “${s.title}”? This cannot be undone.`)) void deleteSession(s.id);
              }}
            >
              <TrashIcon size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
