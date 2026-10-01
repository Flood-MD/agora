import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { ChatsIcon, SendIcon, StopIcon } from './icons';

const DRAFT_KEY = 'agora.draft.';

export function Composer({ onOpenPastChats }: { onOpenPastChats: () => void }) {
  const session = useStore((s) => s.session);
  const send = useStore((s) => s.send);
  const stop = useStore((s) => s.stop);
  const running = session?.running ?? false;
  const activeModels = session?.config.slots.filter((s) => s.model).length ?? 0;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [draftFor, setDraftFor] = useState<string | undefined>();
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
  }

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
    const ok = await send(value);
    setSending(false);
    if (ok) update('');
  };

  return (
    <div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <button
          className="btn size-11 shrink-0 rounded-xl p-0"
          onClick={onOpenPastChats}
          title="Past chats"
          aria-label="Past chats"
        >
          <ChatsIcon size={18} />
        </button>
        <textarea
          ref={box}
          rows={2}
          className="field min-h-[3.25rem] flex-1 resize-none rounded-xl py-3 text-[15px]"
          placeholder={activeModels ? 'Group chat…' : 'Add a model above to start…'}
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
    </div>
  );
}
