import { Link } from "react-router-dom";
import { CONFIG } from "../../shared/config";
import { MAX_ORDERS, SIDE_BUY, SIDE_EMPTY, SIDE_SELL, clear, quoteCeil, type Clearing } from "../../shared/cleara";
import { activeOrders, phaseOf, type AuctionView, type Phase } from "../lib/chain";
import { alias, countdown, dateTime, eventLabel, fmtBase, fmtPrice, fmtQuote, pair } from "../lib/format";
import { DepthChart } from "./DepthChart";
import { Copyable, PhaseBadge, SideTag, Stat, SyntheticTag, Window } from "./ui";

export function useClearing(a: AuctionView): Clearing {
  return clear(a.orders);
}

export function Countdown({ a, now }: { a: AuctionView; now: number }) {
  const p = phaseOf(a, now);
  if (p === "settled") return <span className="mono">Settled</span>;
  if (p === "open" || p === "closing") {
    const left = a.deadline - now;
    return (
      <span className={`mono ${left < 6 * 3600 ? "rounded-[3px] bg-amber-pale px-1" : ""}`}>
        Closes in {countdown(left)}
      </span>
    );
  }
  if (p === "awaiting") return <span className="mono">Settle window {countdown(a.settleBy - now)} left</span>;
  return <span className="mono">Expired {dateTime(a.settleBy)}</span>;
}

export function depth(a: AuctionView) {
  const act = activeOrders(a);
  const buyQty = act.filter((o) => o.side === SIDE_BUY).reduce((s, o) => s + o.qty, 0n);
  const sellQty = act.filter((o) => o.side === SIDE_SELL).reduce((s, o) => s + o.qty, 0n);
  return { buyQty, sellQty, count: act.length };
}

export function EventCard({ a, now, featured }: { a: AuctionView; now: number; featured?: boolean }) {
  const phase = phaseOf(a, now);
  const c = a.status === 1 ? { price: a.clearingPrice, volume: a.clearedVolume, fills: [] } : phase === "expired" ? { price: 0n, volume: 0n, fills: [] } : clear(a.orders);
  const d = depth(a);
  const sym = a.asset?.symbol ?? "—";
  return (
    <Window
      active={featured}
      title={`${eventLabel(a)} · ${pair(a)}`}
      right={<SyntheticTag />}
      bodyClass="p-0"
    >
      <div className="flex flex-col gap-4 p-5 max-sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[17px] font-semibold leading-[22px]">{a.asset?.name ?? a.baseMint}</p>
            <p className="m-0 text-[13px] text-muted">{a.asset?.kind}</p>
          </div>
          <PhaseBadge phase={phase} />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Funded buy interest" value={`${fmtBase(a, d.buyQty)} ${sym}`} />
          <Stat label="Funded sell interest" value={`${fmtBase(a, d.sellQty)} ${sym}`} />
          <Stat
            label={a.status === 1 ? "Clearing price" : phase === "expired" ? "Result" : "Provisional price"}
            value={phase === "expired" ? "Nothing traded" : c.volume > 0n ? `${fmtPrice(a, c.price)} ${CONFIG.quoteSymbol}` : "No overlap"}
          />
          <Stat label="Orders · participants" value={`${d.count} of ${MAX_ORDERS} · ${a.roster.length}`} />
        </div>
        {featured && (
          <DepthChart
            orders={a.orders}
            clearing={c}
            baseDecimals={a.baseDecimals}
            quoteDecimals={a.quoteDecimals}
            quoteSymbol={CONFIG.quoteSymbol}
            baseSymbol={sym}
            height={220}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-emerald bg-champagne/60 px-5 py-3 max-sm:px-4">
        <span className="text-[13px]"><Countdown a={a} now={now} /></span>
        <Link to={`/events/${a.address}`} className="btn btn-primary btn-sm">View event</Link>
      </div>
    </Window>
  );
}

export function OrderBook({ a, me, clearing, onCancel, canCancel }: { a: AuctionView; me: string | null; clearing: Clearing; onCancel?: (slot: number) => void; canCancel: boolean }) {
  const settled = a.status === 1;
  const expired = !settled && Math.floor(Date.now() / 1000) > a.settleBy;
  const sym = a.asset?.symbol ?? "";
  const rows = [...a.orders].sort((x, y) => {
    if (x.side === SIDE_EMPTY) return 1;
    if (y.side === SIDE_EMPTY) return -1;
    if (x.side !== y.side) return x.side === SIDE_BUY ? -1 : 1;
    return x.side === SIDE_BUY ? (y.limitPrice > x.limitPrice ? 1 : -1) : x.limitPrice > y.limitPrice ? 1 : -1;
  });
  return (
    <Window title="Public order book · 8 slots" right={<span className="label text-champagne/85">Readable by anyone onchain</span>} bodyClass="p-0">
      <p className="m-0 border-b border-line px-4 py-2 text-[13px] text-muted">
        Every order below is stored unencrypted in the event account and can be read through Solana RPC. Participants are shown by alias.
      </p>
      <div className="overflow-x-auto">
        <table className="table min-w-[640px]">
          <thead>
            <tr>
              <th scope="col">Slot</th>
              <th scope="col">Side</th>
              <th scope="col">Participant</th>
              <th scope="col" className="text-right">Limit ({CONFIG.quoteSymbol})</th>
              <th scope="col" className="text-right">Quantity ({sym})</th>
              <th scope="col" className="text-right">{settled || expired ? "Filled" : "Fill if closed now"}</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              if (o.side === SIDE_EMPTY)
                return (
                  <tr key={o.slot} className="text-muted">
                    <td className="mono">{o.slot + 1}</td>
                    <td colSpan={6}>Empty slot</td>
                  </tr>
                );
              const fill = settled ? o.filled : expired ? 0n : clearing.fills[o.slot];
              const mine = me === o.owner;
              const state = fill === 0n ? "No fill" : fill === o.qty ? "Full fill" : "Partial fill";
              return (
                <tr key={o.slot} className={mine ? "bg-mint-pale/60" : ""}>
                  <td className="mono">
                    <span className={`mr-2 inline-block h-4 w-1 align-middle ${o.side === SIDE_BUY ? "bg-mint" : "bg-coral"}`} aria-hidden />
                    {o.slot + 1}
                  </td>
                  <td><SideTag side={o.side} /></td>
                  <td>
                    <span className="font-semibold">{alias(o.owner, me)}</span>{" "}
                    <Copyable value={o.owner} />
                  </td>
                  <td className="mono text-right">{fmtPrice(a, o.limitPrice)}</td>
                  <td className="mono text-right">{fmtBase(a, o.qty)}</td>
                  <td className="mono text-right">{fmtBase(a, fill)}</td>
                  <td>
                    <span className="text-[13px]">{settled ? state : expired ? "Refundable" : clearing.volume === 0n ? "Waiting for overlap" : state}</span>
                    {mine && canCancel && onCancel && (
                      <button type="button" className="btn btn-danger btn-sm ml-2 min-h-[32px]" onClick={() => onCancel(o.slot)}>Cancel</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Window>
  );
}

export function ProvisionalClearing({ a, clearing, now }: { a: AuctionView; clearing: Clearing; now: number }) {
  const overlapping = clearing.fills.filter((f) => f > 0n).length;
  const funded = activeOrders(a).length;
  const sym = a.asset?.symbol ?? "";
  if (a.status === 1)
    return (
      <Window title="Final clearing result" active lamp={<span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-champagne bg-mint" aria-hidden />}>
        {a.clearedVolume > 0n ? (
          <div className="flex flex-col gap-3">
            <Stat big label="Clearing price" value={`${fmtPrice(a, a.clearingPrice)} ${CONFIG.quoteSymbol}`} sub={`per ${sym} · every matched order traded at this one price`} />
            <Stat label="Matched volume" value={`${fmtBase(a, a.clearedVolume)} ${sym}`} />
          </div>
        ) : (
          <p className="m-0 text-[15px]">No overlap at the deadline. Nothing traded, and every order was returned in full.</p>
        )}
      </Window>
    );
  if (now > a.settleBy)
    return (
      <Window title="Event expired" lamp={<span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-champagne bg-coral" aria-hidden />}>
        <p className="m-0 text-[15px]">Nobody settled this event before its settlement window closed, so nothing traded at any price.</p>
        <p className="m-0 mt-2 text-[13px] text-muted">Each order's escrow can be refunded to its owner, one order at a time, subject to the token's transfer rules.</p>
      </Window>
    );
  const pastDeadline = now >= a.deadline;
  return (
    <Window title="Provisional clearing price" active lamp={<span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-champagne bg-amber" aria-hidden />}>
      {clearing.volume > 0n ? (
        <div className="flex flex-col gap-3">
          <Stat big label={pastDeadline ? "Result if settled now" : "If the event closed now"} value={`${fmtPrice(a, clearing.price)} ${CONFIG.quoteSymbol}`} sub={`per ${sym}`} />
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Executable volume" value={`${fmtBase(a, clearing.volume)} ${sym}`} />
            <Stat label="Overlapping orders" value={`${overlapping} of ${funded} funded`} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="m-0 mono text-[22px] leading-[28px] font-medium">No executable price yet</p>
          <p className="m-0 text-[13px] text-muted">
            {funded === 0
              ? "No funded orders yet. This event clears only when buy and sell limits overlap."
              : "Orders are funded, but no executable price exists at the current limits."}
          </p>
        </div>
      )}
      <p className="m-0 mt-4 border-t border-line pt-3 text-[13px] leading-[18px] text-muted">
        {pastDeadline
          ? "The order deadline has passed, so the book is fixed. Settlement recomputes this onchain and applies it in one transaction."
          : "Based on funded orders currently in this event. The final result may change until the order deadline."}{" "}
        Computed {new Date(now * 1000).toLocaleTimeString()} with the same rules the program uses. Not a market value.
      </p>
    </Window>
  );
}

export function Rules({ a }: { a: AuctionView }) {
  const sym = a.asset?.symbol ?? "";
  const rows: [string, string][] = [
    ["Order deadline", dateTime(a.deadline)],
    ["Cancellation cutoff", "Same as the order deadline"],
    ["Settlement window", `Until ${dateTime(a.settleBy)}`],
    ["Recovery", "After the settlement window, anyone can refund each order, subject to the token's transfer rules"],
    ["Minimum order", `${fmtBase(a, a.minBaseQty)} ${sym}`],
    ["Order cap", `${MAX_ORDERS} slots in total; per-participant allowance`],
    ["Seller fee", `${(a.feeBps / 100).toFixed(2)}% of proceeds`],
    ["Price rule", "The price that matches the most volume; ties go to the lowest price"],
    ["Allocation", "Price priority, then pro rata at the marginal price; leftover units by slot order"],
    ["Settlement", "All orders settle in one all-or-nothing transaction"],
    ["Participants", `${a.roster.length} approved wallets`],
  ];
  return (
    <Window title="Event rules">
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px] leading-[18px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold text-muted">{k}</dt>
            <dd className="m-0">{v}</dd>
          </div>
        ))}
      </dl>
    </Window>
  );
}

export interface PersonalResult {
  slot: number;
  side: number;
  filled: bigint;
  paid: bigint;
  received: bigint;
  fee: bigint;
  refundBase: bigint;
  refundQuote: bigint;
}

export function personalResult(a: AuctionView, slot: number): PersonalResult {
  const o = a.orders[slot];
  if (o.side === SIDE_BUY) {
    const paid = o.filled > 0n ? quoteCeil(o.filled, a.clearingPrice, a.baseDecimals) : 0n;
    return { slot, side: o.side, filled: o.filled, paid, received: o.filled, fee: 0n, refundBase: 0n, refundQuote: o.escrowed - paid };
  }
  const gross = (o.filled * a.clearingPrice) / 10n ** BigInt(a.baseDecimals);
  const fee = (gross * BigInt(a.feeBps)) / 10000n;
  return { slot, side: o.side, filled: o.filled, paid: 0n, received: gross - fee, fee, refundBase: o.escrowed - o.filled, refundQuote: 0n };
}

export function Allocation({ a, me }: { a: AuctionView; me: string | null }) {
  const sym = a.asset?.symbol ?? "";
  const rows = activeOrders(a);
  return (
    <div className="overflow-x-auto">
      <table className="table min-w-[720px]">
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">Side</th>
            <th scope="col">Participant</th>
            <th scope="col" className="text-right">Limit</th>
            <th scope="col" className="text-right">Quantity</th>
            <th scope="col" className="text-right">Filled ({sym})</th>
            <th scope="col" className="text-right">Settled amount</th>
            <th scope="col" className="text-right">Returned</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const r = personalResult(a, o.slot);
            return (
              <tr key={o.slot} className={me === o.owner ? "bg-mint-pale/60" : ""}>
                <td className="mono">#{o.slot + 1}</td>
                <td><SideTag side={o.side} /></td>
                <td className="font-semibold">{alias(o.owner, me)}</td>
                <td className="mono text-right">{fmtPrice(a, o.limitPrice)}</td>
                <td className="mono text-right">{fmtBase(a, o.qty)}</td>
                <td className="mono text-right">{fmtBase(a, r.filled)}</td>
                <td className="mono text-right">
                  {o.side === SIDE_BUY ? `paid ${fmtQuote(a, r.paid)}` : `got ${fmtQuote(a, r.received)}`} {CONFIG.quoteSymbol}
                </td>
                <td className="mono text-right">
                  {o.side === SIDE_BUY ? `${fmtQuote(a, r.refundQuote)} ${CONFIG.quoteSymbol}` : `${fmtBase(a, r.refundBase)} ${sym}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function phaseSortKey(p: Phase) {
  return { closing: 0, open: 1, awaiting: 2, expired: 3, settled: 4 }[p];
}
