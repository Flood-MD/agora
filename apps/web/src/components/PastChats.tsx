import type { SessionSummary } from '@agora/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { PencilIcon, PlusIcon, SearchIcon, TrashIcon } from './icons';
import { Modal } from './Modal';

const SEARCH_DELAY_MS = 200;

function when(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
      });
}

/** Past chats: search every saved chat by title and message text, open, rename or delete. */
export function PastChats({
  onOpenSession,
  onNewSession,
  onClose,
}: {
  onOpenSession: (id: string) => void;
  onNewSession: () => void;
  onClose: () => void;
}) {
  const current = useStore((s) => s.session?.id);
  const renameSession = useStore((s) => s.renameSession);
  const deleteSession = useStore((s) => s.deleteSession);
  const showToast = useStore((s) => s.showToast);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SessionSummary[]>();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(
      () => {
        api
          .sessions(query)
          .then((list) => !cancelled && setResults(list))
          .catch((err) => showToast(`Could not load chats: ${err instanceof Error ? err.message : err}`));
      },
      query ? SEARCH_DELAY_MS : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, version, showToast]);

  const open = (id: string) => {
    onClose();
    onOpenSession(id);
  };

  return (
    <Modal title="Past chats" onClose={onClose} wide>
      <div className="sticky -top-4 z-10 -mx-5 -mt-4 flex gap-2 bg-panel px-5 pb-3 pt-4">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            autoFocus
            className="field pl-9"
            placeholder="Search titles and messages…"
            aria-label="Search chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className="btn shrink-0"
          onClick={() => {
            onClose();
            onNewSession();
          }}
        >
          <PlusIcon /> <span className="hidden sm:inline">New chat</span>
        </button>
      </div>

      {results === undefined && <p className="py-6 text-center text-sm text-muted">Loading…</p>}
      {results?.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">
          {query ? `No chats mention “${query}”.` : 'No chats yet.'}
        </p>
      )}
      <ul className="-mx-2">
        {results?.map((s) => (
          <li
            key={s.id}
            className={`group flex items-center rounded-md hover:bg-panel-2 ${s.id === current ? 'bg-panel-2' : ''}`}
          >
            <button className="min-w-0 flex-1 px-2 py-2 text-left" onClick={() => open(s.id)}>
              <span className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium">{s.title}</span>
                {s.running && <span className="shrink-0 text-[11px] text-green-400">responding…</span>}
              </span>
              {s.match && s.match !== s.title && (
                <span className="block truncate text-xs text-slate-300">{s.match}</span>
              )}
              <span className="block text-xs text-muted">
                {when(s.updatedAt)} · {s.messageCount} message{s.messageCount === 1 ? '' : 's'}
              </span>
            </button>
            <button
              className="p-2 text-muted hover:text-white"
              title="Rename"
              aria-label={`Rename ${s.title}`}
              onClick={async () => {
                const title = prompt('Rename chat', s.title)?.trim();
                if (title) {
                  await renameSession(s.id, title);
                  setVersion((v) => v + 1);
                }
              }}
            >
              <PencilIcon size={14} />
            </button>
            <button
              className="p-2 text-muted hover:text-red-400"
              title="Delete"
              aria-label={`Delete ${s.title}`}
              onClick={async () => {
                if (!confirm(`Delete “${s.title}”? This cannot be undone.`)) return;
                await deleteSession(s.id);
                setVersion((v) => v + 1);
              }}
            >
              <TrashIcon size={14} />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
