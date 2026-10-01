import { activeSlots, type ContextItem } from '@agora/shared';
import { useState } from 'react';
import { useStore } from '../store';
import { FileIcon, FolderIcon, GithubIcon, ImageIcon, MicIcon, PlayIcon, XIcon } from './icons';
import { Modal } from './Modal';

const ICONS = {
  file: FileIcon,
  folder: FolderIcon,
  image: ImageIcon,
  github: GithubIcon,
  youtube: PlayIcon,
  transcript: MicIcon,
} as const;

const PREVIEW_CHARS = 20_000;

export function formatTokens(n: number) {
  return n >= 1_000_000
    ? `${+(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${+(n / 1000).toFixed(1)}K`
      : String(n);
}

/** Attachments above the message box: what every model sees, with sizes and a remove button. */
export function ContextChips() {
  const items = useStore((s) => s.context);
  const attaching = useStore((s) => s.attaching);
  const removeContext = useStore((s) => s.removeContext);
  const config = useStore((s) => s.session?.config);
  const models = useStore((s) => s.catalog.models);
  const [preview, setPreview] = useState<ContextItem>();

  if (!items.length && !attaching) return null;
  const total = items.reduce((n, i) => n + i.tokens, 0);
  // The smallest known context window among the chat's models.
  const windows = (config ? activeSlots(config) : [])
    .map((s) => models.find((m) => m.id === s.model)?.contextLength)
    .filter((n): n is number => !!n);
  const smallest = windows.length ? Math.min(...windows) : undefined;
  const tooBig = smallest !== undefined && total > smallest * 0.8;

  return (
    <div className="mx-auto mb-2 flex max-w-3xl flex-wrap items-center gap-1.5" aria-label="Attachments">
      {items.map((item) => {
        const Icon = ICONS[item.kind];
        return (
          <span
            key={item.id}
            className="flex max-w-full items-center gap-1.5 rounded-full border border-line bg-panel-2 py-1 pl-2.5 pr-1 text-xs"
            data-testid="context-chip"
          >
            <button
              className="flex min-w-0 items-center gap-1.5"
              onClick={() => setPreview(item)}
              title={item.note}
            >
              <Icon size={13} className="shrink-0 text-muted" />
              <span className="max-w-48 truncate">{item.title}</span>
              <span className="tabular-nums text-muted">{formatTokens(item.tokens)}</span>
            </button>
            <button
              className="rounded-full p-0.5 text-muted hover:bg-field hover:text-white"
              onClick={() => void removeContext(item.id)}
              aria-label={`Remove ${item.title}`}
            >
              <XIcon size={12} />
            </button>
          </span>
        );
      })}
      {attaching && (
        <span className="animate-pulse rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-muted">
          Adding {attaching}…
        </span>
      )}
      {items.length > 1 && (
        <span className={`text-[11px] tabular-nums ${tooBig ? 'text-amber-400' : 'text-muted'}`}>
          {formatTokens(total)} tokens
          {tooBig && ` · close to the smallest model's ${formatTokens(smallest!)} limit`}
        </span>
      )}
      {items.length === 1 && tooBig && (
        <span className="text-[11px] text-amber-400">
          close to the smallest model's {formatTokens(smallest!)} limit
        </span>
      )}
      {preview && (
        <Modal title={preview.title} onClose={() => setPreview(undefined)} wide>
          {preview.note && <p className="mb-2 text-xs text-muted">{preview.note}</p>}
          {preview.kind === 'image' && preview.data ? (
            <img
              src={`data:${preview.mediaType};base64,${preview.data}`}
              alt={preview.title}
              className="mx-auto max-h-[60dvh] rounded-md"
            />
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-md bg-black/30 p-3 text-xs">
              {preview.text.slice(0, PREVIEW_CHARS)}
              {preview.text.length > PREVIEW_CHARS && `\n\n… ${formatTokens(preview.tokens)} tokens in total`}
            </pre>
          )}
        </Modal>
      )}
    </div>
  );
}
