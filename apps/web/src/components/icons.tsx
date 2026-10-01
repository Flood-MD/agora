import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function icon(path: React.ReactNode) {
  return function Icon({ size = 16, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {path}
      </svg>
    );
  };
}

export const XIcon = icon(<path d="M18 6 6 18M6 6l12 12" />);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />);
export const SendIcon = icon(
  <>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4z" />
  </>,
);
export const StopIcon = icon(<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />);
export const RefreshIcon = icon(
  <>
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
    <path d="M21 3v5h-5M3 21v-5h5" />
  </>,
);
export const TrashIcon = icon(<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />);
export const PencilIcon = icon(<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />);
export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </>,
);
