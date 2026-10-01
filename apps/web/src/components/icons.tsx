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
export const DownloadIcon = icon(<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3" />);
export const UploadIcon = icon(<path d="M12 15V3m0 0L8 7m4-4 4 4M4 17v3h16v-3" />);
export const ChatsIcon = icon(<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />);
export const MinusIcon = icon(<path d="M5 12h14" />);
export const ArrowUpIcon = icon(<path d="M12 19V5m0 0-6 6m6-6 6 6" />);
export const CrownIcon = icon(<path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z" />);
export const FusionIcon = icon(
  <>
    <circle cx="6" cy="5" r="2" />
    <circle cx="18" cy="5" r="2" />
    <circle cx="12" cy="19" r="2" />
    <path d="M6 7c0 5 6 5 6 10M18 7c0 5-6 5-6 10" />
  </>,
);
export const LockIcon = icon(
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>,
);
export const LoopIcon = icon(
  <path d="M21 12a9 9 0 0 1-9 9H8m-5-9a9 9 0 0 1 9-9h4m0 0-3-3m3 3-3 3M8 21l3 3m-3-3 3-3" />,
);
export const PaperclipIcon = icon(
  <path d="m21 11-8.6 8.6a5 5 0 0 1-7-7l8.5-8.6a3.3 3.3 0 0 1 4.7 4.7L10 17.3a1.7 1.7 0 0 1-2.3-2.3l7.9-7.9" />,
);
export const GlobeIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </>,
);
export const FileIcon = icon(<path d="M14 3H6v18h12V7zM14 3v4h4" />);
export const FolderIcon = icon(<path d="M3 6h6l2 2h10v11H3z" />);
export const ImageIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="m21 16-5-5-9 9" />
  </>,
);
export const GithubIcon = icon(
  <path d="M9 19c-4 1.5-4-2-6-2.5m12 5V18a3.4 3.4 0 0 0-1-2.6c3.2-.4 6.5-1.6 6.5-7a5.4 5.4 0 0 0-1.5-3.8 5 5 0 0 0-.1-3.8s-1.2-.4-3.9 1.5a13.4 13.4 0 0 0-7 0C6.3 2.4 5.1 2.8 5.1 2.8A5 5 0 0 0 5 6.6a5.4 5.4 0 0 0-1.5 3.8c0 5.4 3.3 6.6 6.5 7A3.4 3.4 0 0 0 9 18v3.5" />,
);
export const MicIcon = icon(
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </>,
);
export const PlayIcon = icon(
  <>
    <rect x="2" y="5" width="20" height="14" rx="4" />
    <path d="m10 9 5 3-5 3z" fill="currentColor" />
  </>,
);
