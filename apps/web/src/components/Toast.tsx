import { useEffect } from 'react';
import { useStore } from '../store';
import { XIcon } from './icons';

export function Toast() {
  const toast = useStore((s) => s.toast);
  const showToast = useStore((s) => s.showToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => showToast(undefined), 6000);
    return () => clearTimeout(t);
  }, [toast, showToast]);

  if (!toast) return null;
  return (
    <div className="fixed inset-x-0 top-3 z-[60] flex justify-center px-3" role="status">
      <div className="flex max-w-md items-start gap-2 rounded-lg border border-line bg-panel-2 px-4 py-2.5 text-sm shadow-xl">
        <span className="flex-1">{toast}</span>
        <button
          className="text-muted hover:text-white"
          onClick={() => showToast(undefined)}
          aria-label="Dismiss"
        >
          <XIcon size={14} />
        </button>
      </div>
    </div>
  );
}
