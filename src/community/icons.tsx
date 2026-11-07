import type { ReactNode } from 'react';

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const HomeIcon = () => <Icon><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></Icon>;
export const CompassIcon = () => <Icon><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></Icon>;
export const BellIcon = () => <Icon><path d="M6 10a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7z" /><path d="M10 20a2.2 2.2 0 0 0 4 0" /></Icon>;
export const BookmarkIcon = ({ on = false }: { on?: boolean }) => <Icon><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" fill={on ? 'currentColor' : 'none'} /></Icon>;
export const UserIcon = () => <Icon><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></Icon>;
export const CardIcon = () => <Icon><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 15l3-3 3 2 4-5" /></Icon>;
export const SearchIcon = () => <Icon size={17}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Icon>;
export const ReplyIcon = () => <Icon size={18}><path d="M12 20a8 8 0 1 0-7-4l-1 4 4-1a8 8 0 0 0 4 1z" /></Icon>;
export const RepostIcon = () => <Icon size={18}><path d="M4 11V8a2 2 0 0 1 2-2h12l-3-3M20 13v3a2 2 0 0 1-2 2H6l3 3" /></Icon>;
export const HeartIcon = ({ on = false }: { on?: boolean }) => <Icon size={18}><path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z" fill={on ? 'currentColor' : 'none'} /></Icon>;
export const ShareIcon = () => <Icon size={18}><path d="M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" /></Icon>;
export const PhotoIcon = () => <Icon size={18}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" /></Icon>;
export const MoreIcon = () => <Icon size={18}><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></Icon>;
export const PlusIcon = () => <Icon size={18}><path d="M12 5v14M5 12h14" /></Icon>;
export const CloseIcon = () => <Icon size={18}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
