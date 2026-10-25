/** The journal's line icons, stroked in the current text colour. Sizes follow the reference's ink. */

function Icon({ d, size = 16, stroke = 2 }: { d: string; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

export const CloseIcon = () => <Icon d="M18 6 6 18M6 6l12 12" size={19} stroke={2.1} />;
/** A tray with an arrow out of it: the reference's share mark. */
export const ShareIcon = ({ size = 22 }: { size?: number }) => (
  <Icon d="M12 13V4m0 0L8.5 7.5M12 4l3.5 3.5M4 12v4.5A1.5 1.5 0 0 0 5.5 18h13a1.5 1.5 0 0 0 1.5-1.5V12" size={size} stroke={2.1} />
);
export const CalendarIcon = () => (
  <Icon d="M8 3v3m8-3v3M4 10h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 14h2m4 0h2m-8 3h2" size={19} />
);
export const ChevronLeft = () => <Icon d="m15 18-6-6 6-6" size={16} />;
export const ChevronRight = () => <Icon d="m9 18 6-6-6-6" size={16} />;
export const SearchIcon = () => <Icon d="m21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z" size={14} />;
export const PlusIcon = () => <Icon d="M12 5v14M5 12h14" size={14} stroke={2.4} />;
export const ClockIcon = () => <Icon d="M12 7v5l3 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z" size={14} />;
export const InfoIcon = () => <Icon d="M12 16v-5m0-3h.01M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z" size={13} />;
export const TradesIcon = () => <Icon d="M7 4v16M17 4v16M4 8h6M14 15h6M4 16h6M14 8h6" size={16} />;
export const ImageIcon = () => (
  <Icon d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm15 11-5-5L5 20M9 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" size={16} />
);
export const VideoIcon = () => (
  <Icon d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm5 5v6l5-3z" size={16} />
);
export const DownloadIcon = () => <Icon d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14" size={17} />;
export const CopyIcon = () => (
  <Icon d="M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4.5A.5.5 0 0 1 4 14.5V4.5a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 .5.5V5" size={16} />
);
export const CustomizeIcon = () => <Icon d="M4 5h16M4 10h10M4 15h6M15 13l5 5m-5 0v-5h5" size={17} />;
export const TrashIcon = () => <Icon d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 11v5M13.5 11v5" size={17} />;
export const AdvancedIcon = () => (
  <Icon d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 9h8M8 13h8M8 17h5" size={17} />
);
export const SwapIcon = () => <Icon d="M4 8h14l-4-4M20 16H6l4 4" size={18} />;
export const PlayIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
  </svg>
);
export const PauseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" />
  </svg>
);
export const SettingsIcon = () => (
  <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" size={17} stroke={1.9} />
);

/** Astra's mark — the same four-point star the topbar draws with a clip-path. */
export function AstraMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <polygon points="50,0 60,40 100,50 60,60 50,100 40,60 0,50 40,40" fill="currentColor" />
    </svg>
  );
}

/** The blank avatar the account menu uses. */
export function Silhouette() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle cx="20" cy="15.5" r="7" fill="currentColor" />
      <path d="M4 42c0-9.4 7.2-16 16-16s16 6.6 16 16z" fill="currentColor" />
    </svg>
  );
}
