/** Lucide-shaped line icons (the set bWalletX's TopNav uses), inline so the site needs no icon package. */
type P = { size?: number; color?: string };
const svg = (size: number, color: string, children: React.ReactNode, fill = 'none') => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
export const MenuIcon = ({ size = 22, color = 'currentColor' }: P) => svg(size, color, <path d="M4 6h16M4 12h16M4 18h16" />);
export const TrophyIcon = ({ size = 16, color = 'currentColor' }: P) =>
  svg(size, color, <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></>);
export const VolumeIcon = ({ size = 16, color = 'currentColor' }: P) =>
  svg(size, color, <><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" /></>);
export const MuteIcon = ({ size = 16, color = 'currentColor' }: P) =>
  svg(size, color, <><path d="M11 5 6 9H2v6h4l5 4V5Z" /><path d="m22 9-6 6M16 9l6 6" /></>);
export const MaximizeIcon = ({ size = 16, color = 'currentColor' }: P) =>
  svg(size, color, <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />);
export const MinimizeIcon = ({ size = 16, color = 'currentColor' }: P) =>
  svg(size, color, <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />);
export const GamepadIcon = ({ size = 16, color = 'currentColor' }: P) =>
  svg(size, color, <><path d="M6 12h4M8 10v4M15 13h.01M18 11h.01" /><rect x="2" y="6" width="20" height="12" rx="2" /></>);
export const BackIcon = ({ size = 16, color = 'currentColor' }: P) => svg(size, color, <path d="m15 18-6-6 6-6" />);
export const GiftIcon = ({ size = 14, color = 'currentColor' }: P) =>
  svg(size, color, <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" /></>);
export const PhoneIcon = ({ size = 14, color = 'currentColor' }: P) =>
  svg(size, color, <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />);
