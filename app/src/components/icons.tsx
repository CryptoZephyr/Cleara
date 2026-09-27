import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 16): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "square",
  "aria-hidden": true,
  focusable: false,
});

export const IconClock = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>
);
export const IconOpen = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="8" cy="8" r="5.5" /></svg>
);
export const IconTimer = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="8" cy="9" r="5" /><path d="M8 9V6.5M6 1.5h4" /></svg>
);
export const IconLock = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="3" y="7" width="10" height="7" /><path d="M5 7V5a3 3 0 0 1 6 0v2" /></svg>
);
export const IconCheck = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M3 8.5l3 3 7-7" /></svg>
);
export const IconExpiry = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 2h8M4 14h8M5 2c0 4 6 4 6 6s-6 2-6 6M11 2c0 4-6 4-6 6s6 2 6 6" /></svg>
);
export const IconWarn = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M8 2l6.5 12h-13z" /><path d="M8 6.5v3.5M8 12v.5" /></svg>
);
export const IconUp = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M8 13V3M4 7l4-4 4 4" /></svg>
);
export const IconDown = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M8 3v10M4 9l4 4 4-4" /></svg>
);
export const IconX = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
);
export const IconExternal = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M9 3h4v4M13 3L7 9M11 10v3H3V5h3" /></svg>
);
export const IconCopy = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="5" y="5" width="8" height="8" /><path d="M3 11V3h8" /></svg>
);
export const IconMenu = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M2 4h12M2 8h12M2 12h12" /></svg>
);
export const IconRefund = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M3 6h7a3 3 0 0 1 0 6H6M3 6l3-3M3 6l3 3" /></svg>
);

export function Mark({ size = 24 }: { size?: number }) {
  return <img src="/cleara-logo.png" width={size} height={size} alt="" aria-hidden className="block shrink-0" />;
}
