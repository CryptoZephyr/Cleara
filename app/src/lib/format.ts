import { CONFIG } from "../../shared/config";
import { formatAtoms } from "../../shared/cleara";
import type { AuctionView } from "./chain";

export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function alias(owner: string, me: string | null): string {
  if (me && owner === me) return "You";
  const i = CONFIG.bots.indexOf(owner);
  if (i >= 0) return `Demo bot ${i + 1}`;
  return short(owner);
}

export const fmtPrice = (a: AuctionView, p: bigint) => formatAtoms(p, a.quoteDecimals, 4);
export const fmtBase = (a: AuctionView, q: bigint) => formatAtoms(q, a.baseDecimals, 4);
export const fmtQuote = (a: AuctionView, q: bigint) => formatAtoms(q, a.quoteDecimals, 6);

export const eventLabel = (a: AuctionView) => `EVENT ${a.address.slice(0, 4).toUpperCase()}`;
export const pair = (a: AuctionView) => `${a.asset?.symbol ?? short(a.baseMint)} / ${CONFIG.quoteSymbol}`;

export function countdown(secs: number): string {
  if (secs <= 0) return "00:00:00";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return d > 0 ? `${p(d)}d ${p(h)}h ${p(m)}m` : `${p(h)}:${p(m)}:${p(s)}`;
}

export const dateTime = (unix: number) =>
  new Date(unix * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
