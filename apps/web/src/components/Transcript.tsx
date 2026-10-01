import { memo, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, Slot } from '@agora/shared';
import { slotDisplayName } from '@agora/shared';
import { useStore } from '../store';
import { LockIcon } from './icons';

const FALLBACK_COLOR = '#64748b';

export function Transcript() {
  const messages = useStore((s) => s.messages);
  const slots = useStore((s) => s.session?.config.slots);
  const showModelNames = useStore((s) => s.session?.config.showModelNames ?? false);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow new tokens only while the reader is at the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3" aria-live="polite">
        {messages.length === 0 && (
          <p className="mt-[20vh] text-center text-sm text-muted">
            Add models with the + card above, then send a message to the whole group.
          </p>
        )}
        {messages.map((m) => (
          <MessageView
            key={m.id}
            message={m}
            slot={slots?.find((s) => s.id === m.author)}
            showModelName={showModelNames}
            /* Name of the one model a user message (or private reply) was for. */
            toName={nameFor(slots, m.target ?? (m.audience !== 'all' ? m.audience : undefined))}
          />
        ))}
      </div>
    </div>
  );
}

function nameFor(slots: Slot[] | undefined, id: string | undefined) {
  if (!id) return undefined;
  const slot = slots?.find((s) => s.id === id);
  return slot ? slotDisplayName(slot) : 'a removed model';
}

const KIND_LABELS = { leader: 'Leader', fusion: 'Fusion', 'self-chat': 'Self-Chat' } as const;

const MessageView = memo(function MessageView({
  message: m,
  slot,
  showModelName,
  toName,
}: {
  message: Message;
  slot?: Slot;
  showModelName: boolean;
  toName?: string;
}) {
  const isPrivate = m.audience !== 'all';
  if (m.author === 'user') {
    return (
      <div
        className={`ml-auto max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 ${
          isPrivate ? 'border border-dashed border-slate-400/60 bg-field/60' : 'bg-field'
        }`}
        data-testid="user-message"
        data-private={isPrivate || undefined}
      >
        {toName && (
          <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted">
            {isPrivate && <LockIcon size={11} />}
            {isPrivate ? `Private to ${toName}` : `To ${toName}`}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words text-[15px]">{m.text}</div>
      </div>
    );
  }

  const color = slot?.color ?? FALLBACK_COLOR;
  const name = slot ? slotDisplayName(slot) : m.authorName;
  const streaming = m.status === 'streaming';

  return (
    <article
      className={`rounded-xl border px-4 py-3 ${
        m.kind === 'fusion' ? 'border-blue-400/40 bg-blue-950/30' : 'border-line bg-panel/90'
      } ${isPrivate ? 'border-dashed' : ''}`}
      style={{ borderLeft: `3px ${isPrivate ? 'dashed' : 'solid'} ${color}` }}
      data-testid="model-message"
      data-status={m.status}
      data-kind={m.kind}
      data-private={isPrivate || undefined}
    >
      <header className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-semibold" style={{ color }}>
          {name}
        </span>
        {m.kind && (
          <span className="rounded bg-field px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-slate-300">
            {KIND_LABELS[m.kind]}
          </span>
        )}
        {isPrivate && (
          <span className="flex items-center gap-1 text-[11px] text-muted">
            <LockIcon size={11} /> Private
          </span>
        )}
        {showModelName && slot?.customName && <span className="text-xs text-muted">{slot.modelLabel}</span>}
      </header>
      {m.text ? (
        <div className={`prose-msg ${streaming ? 'cursor-blink' : ''}`}>
          <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
        </div>
      ) : (
        streaming && <div className="cursor-blink text-sm text-muted">Thinking…</div>
      )}
      {m.status === 'error' && (
        <p className="mt-2 rounded-md bg-red-950/50 px-3 py-2 text-sm text-red-300">
          {m.error ?? 'Request failed.'}
        </p>
      )}
      {(m.status === 'stopped' || m.status === 'interrupted') && (
        <p className="mt-2 text-xs text-amber-400">
          {m.status === 'stopped' ? 'Stopped' : (m.error ?? 'Interrupted')}
        </p>
      )}
      {m.status === 'done' && (m.usage?.outputTokens || m.latencyMs) && (
        <footer className="mt-2 text-[11px] tabular-nums text-muted">
          {[
            m.usage?.inputTokens && `${m.usage.inputTokens.toLocaleString()} in`,
            m.usage?.outputTokens && `${m.usage.outputTokens.toLocaleString()} out`,
            m.latencyMs && `${(m.latencyMs / 1000).toFixed(1)}s`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </footer>
      )}
    </article>
  );
});
