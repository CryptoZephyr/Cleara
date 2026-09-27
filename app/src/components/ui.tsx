import { useState, type ReactNode } from "react";
import type { Phase } from "../lib/chain";
import { SIDE_BUY } from "../../shared/cleara";
import {
  IconCheck,
  IconClock,
  IconCopy,
  IconDown,
  IconExpiry,
  IconLock,
  IconOpen,
  IconTimer,
  IconUp,
  IconWarn,
} from "./icons";

export function Window({
  title,
  lamp,
  right,
  active,
  children,
  className = "",
  bodyClass = "p-5 max-sm:p-4",
  id,
}: {
  title: ReactNode;
  lamp?: ReactNode;
  right?: ReactNode;
  active?: boolean;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`window ${active ? "window-active" : ""} ${className}`}>
      <header className="window-bar">
        {lamp}
        <h2 className="m-0 min-w-0 flex-1 truncate text-[13px]">{title}</h2>
        {right}
      </header>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

const PHASE: Record<Phase, { text: string; cls: string; Icon: typeof IconOpen }> = {
  open: { text: "Open", cls: "bg-mint-pale border-emerald text-ink", Icon: IconOpen },
  closing: { text: "Closing soon", cls: "bg-amber-pale border-ink text-ink", Icon: IconTimer },
  awaiting: { text: "Closed · awaiting settlement", cls: "bg-champagne border-muted text-ink", Icon: IconLock },
  settled: { text: "Settled", cls: "bg-emerald border-emerald text-champagne", Icon: IconCheck },
  expired: { text: "Expired · refunds open", cls: "bg-coral-pale border-coral text-ink", Icon: IconExpiry },
};

export function PhaseBadge({ phase }: { phase: Phase }) {
  const p = PHASE[phase];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[4px] border-2 px-2 py-0.5 label ${p.cls}`}>
      <p.Icon size={13} />
      {p.text}
    </span>
  );
}

export function SideTag({ side }: { side: number }) {
  const buy = side === SIDE_BUY;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[3px] border border-ink px-1.5 py-px label ${buy ? "bg-mint" : "bg-coral"}`}
    >
      {buy ? <IconUp size={12} /> : <IconDown size={12} />}
      {buy ? "Buy" : "Sell"}
    </span>
  );
}

export function NetBadge({ net }: { net: "devnet" | "mainnet" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[3px] px-2 py-0.5 label text-cream ${net === "devnet" ? "bg-devnet" : "bg-mainnet"}`}
    >
      <span className="inline-block h-2 w-2 rounded-full border border-cream" aria-hidden />
      {net === "devnet" ? "Devnet event" : "Mainnet quote"}
    </span>
  );
}

export function SyntheticTag() {
  return <span className="inline-flex items-center rounded-[3px] border border-devnet px-1.5 py-px label text-devnet">Synthetic</span>;
}

export function Notice({ tone, title, children }: { tone: "info" | "warn" | "danger" | "ok"; title: string; children?: ReactNode }) {
  const cls = {
    info: "border-line bg-cream",
    warn: "border-amber bg-amber-pale",
    danger: "border-danger bg-cream",
    ok: "border-emerald bg-mint-pale",
  }[tone];
  const Icon = tone === "ok" ? IconCheck : tone === "info" ? IconClock : IconWarn;
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={`flex gap-3 rounded-[4px] border-2 p-3 ${cls}`}>
      <Icon size={18} className={`mt-0.5 shrink-0 ${tone === "danger" ? "text-danger" : ""}`} />
      <div className="min-w-0 text-[13px] leading-[18px]">
        <p className="m-0 font-bold">{title}</p>
        {children && <div className="mt-1 text-muted">{children}</div>}
      </div>
    </div>
  );
}

export function Copyable({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex min-h-[28px] cursor-pointer items-center gap-1 border-0 bg-transparent p-0 mono text-[13px] text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      aria-label={`Copy ${value}`}
    >
      {label ?? `${value.slice(0, 4)}…${value.slice(-4)}`}
      {done ? <IconCheck size={12} /> : <IconCopy size={12} />}
      <span className="sr-only" aria-live="polite">{done ? "Copied" : ""}</span>
    </button>
  );
}

export function Stat({ label, value, sub, big }: { label: string; value: ReactNode; sub?: ReactNode; big?: boolean }) {
  return (
    <div>
      <p className="m-0 label text-muted">{label}</p>
      <p className={`m-0 mono ${big ? "text-[30px] leading-[34px] font-medium" : "text-[15px] leading-[22px] font-medium"}`}>{value}</p>
      {sub && <p className="m-0 text-[13px] leading-[18px] text-muted">{sub}</p>}
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-9" />
      ))}
    </div>
  );
}
