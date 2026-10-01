import { slotDisplayName } from '@agora/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { ChatsIcon, RefreshIcon, SendIcon, StopIcon } from './icons';
import { ModesRow } from './ModesRow';

const DRAFT_KEY = 'agora.draft.';

export function Composer({ onOpenPastChats }: { onOpenPastChats: () => void }) {
  const session = useStore((s) => s.session);
  const send = useStore((s) => s.send);
  const stop = useStore((s) => s.stop);
  const regenerate = useStore((s) => s.regenerate);
  const privateDm = useStore((s) => s.prefs.privateDm);
  const hasMessages = useStore((s) => s.messages.length > 0);
  const running = session?.running ?? false;
  const activeModels = session?.config.slots.filter((s) => s.model).length ?? 0;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [draftFor, setDraftFor] = useState<string | undefined>();
  /** Slot id to send to one model only, or '' for everyone. Reset when switching chats. */
  const [target, setTarget] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  // Per-device draft per chat, restored when switching chats.
  if (session?.id !== draftFor) {
    setDraftFor(session?.id);
    let draft = '';
    try {
      draft = (session && localStorage.getItem(DRAFT_KEY + session.id)) || '';
    } catch {
      // storage unavailable
    }
    setText(draft);
    setTarget('');
  }
  // The chosen model was removed (here or on another device): back to everyone.
  const targetSlot = session?.config.slots.find((s) => s.id === target && s.model);
  if (target && session && !targetSlot) setTarget('');

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const update = (value: string) => {
    setText(value);
    try {
      if (session) localStorage.setItem(DRAFT_KEY + session.id, value);
    } catch {
      // storage unavailable
    }
  };

  const submit = async () => {
    const value = text.trim();
    if (!value || running || sending) return;
    setSending(true);
    const ok = await send(value, target ? { target, private: privateDm } : undefined);
    setSending(false);
    if (ok) update('');
  };

  return (
    <div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            className="btn size-9 rounded-lg p-0"
            onClick={onOpenPastChats}
            title="Past chats"
            aria-label="Past chats"
          >
            <ChatsIcon size={16} />
          </button>
          <button
            className="btn size-9 rounded-lg p-0"
            onClick={() => void regenerate()}
            disabled={running || !hasMessages}
            title="Regenerate the last round's replies"
            aria-label="Regenerate"
          >
            <RefreshIcon size={16} />
          </button>
        </div>
        <textarea
          ref={box}
          rows={2}
          className="field min-h-[3.25rem] flex-1 resize-none rounded-xl py-3 text-[15px]"
          placeholder={
            !activeModels
              ? 'Add a model above to start…'
              : targetSlot
                ? `${privateDm ? 'Private message' : 'Message'} to ${slotDisplayName(targetSlot)}…`
                : 'Group chat…'
          }
          value={text}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape' && running) {
              void stop();
            }
          }}
          aria-label="Message"
        />
        {running ? (
          <button
            className="btn btn-danger size-11 rounded-xl p-0"
            onClick={() => void stop()}
            aria-label="Stop"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            className="btn size-11 rounded-xl p-0"
            onClick={() => void submit()}
            disabled={!text.trim() || sending || !session}
            aria-label="Send"
          >
            <SendIcon />
          </button>
        )}
      </div>
      <ModesRow
        target={target}
        setTarget={setTarget}
        takeTopic={() => {
          const topic = text.trim();
          update('');
          return topic;
        }}
      />
    </div>
  );
}
