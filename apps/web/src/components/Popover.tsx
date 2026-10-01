import { useEffect, useRef, type ReactNode } from 'react';

/** A small panel anchored above its trigger; closes on outside click or Escape. */
export function Popover({
  onClose,
  children,
  label,
  align = 'left',
  className = 'w-64',
}: {
  onClose: () => void;
  children: ReactNode;
  label: string;
  /** Which edge of the trigger the panel lines up with. */
  align?: 'left' | 'right';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={`absolute bottom-full z-40 mb-2 rounded-lg border border-line bg-panel p-3 shadow-xl ${
        align === 'right' ? 'right-0' : 'left-0'
      } ${className}`}
    >
      {children}
    </div>
  );
}
