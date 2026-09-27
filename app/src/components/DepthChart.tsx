import { SIDE_BUY, SIDE_SELL, formatAtoms, type BookOrder, type Clearing } from "../../shared/cleara";

interface Props {
  orders: BookOrder[];
  clearing: Clearing;
  baseDecimals: number;
  quoteDecimals: number;
  quoteSymbol: string;
  baseSymbol: string;
  height?: number;
  compact?: boolean;
  title?: string;
  animatePoint?: boolean;
}

const W = 600;

/** Stepped demand (bids, descending) and supply (asks, ascending) curves from the same order book shown elsewhere. */
export function DepthChart({ orders, clearing, baseDecimals, quoteDecimals, quoteSymbol, baseSymbol, height = 280, compact, title, animatePoint }: Props) {
  const H = height;
  const pad = { l: compact ? 44 : 64, r: 16, t: 16, b: compact ? 28 : 40 };
  const buys = orders.filter((o) => o.side === SIDE_BUY).sort((a, b) => (b.limitPrice > a.limitPrice ? 1 : -1));
  const sells = orders.filter((o) => o.side === SIDE_SELL).sort((a, b) => (a.limitPrice > b.limitPrice ? 1 : -1));
  const toQ = (q: bigint) => Number(q) / 10 ** baseDecimals;
  const toP = (p: bigint) => Number(p) / 10 ** quoteDecimals;
  const totalBuy = buys.reduce((s, o) => s + toQ(o.qty), 0);
  const totalSell = sells.reduce((s, o) => s + toQ(o.qty), 0);
  const prices = [...buys, ...sells].map((o) => toP(o.limitPrice));
  if (prices.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-[4px] border border-dashed border-line text-[13px] text-muted" style={{ height: H }}>
        No funded orders yet. This event clears only when buy and sell limits overlap.
      </div>
    );
  }
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const span = maxP - minP || maxP * 0.2 || 1;
  const lo = Math.max(0, minP - span * 0.25);
  const hi = maxP + span * 0.25;
  const maxQ = Math.max(totalBuy, totalSell) * 1.1 || 1;
  const x = (q: number) => pad.l + (q / maxQ) * (W - pad.l - pad.r);
  const y = (p: number) => pad.t + (1 - (p - lo) / (hi - lo)) * (H - pad.t - pad.b);

  function steps(list: BookOrder[], edge: number) {
    let cum = 0;
    let d = `M ${x(0)} ${y(toP(list[0].limitPrice))}`;
    for (const o of list) {
      const p = toP(o.limitPrice);
      d += ` V ${y(p)}`;
      cum += toQ(o.qty);
      d += ` H ${x(cum)}`;
    }
    d += ` V ${y(edge)}`;
    return d;
  }

  const hasCross = clearing.volume > 0n;
  const bestBid = buys[0] ? toP(buys[0].limitPrice) : null;
  const bestAsk = sells[0] ? toP(sells[0].limitPrice) : null;
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1];
  const cx = hasCross ? x(toQ(clearing.volume)) : 0;
  const cy = hasCross ? y(toP(clearing.price)) : 0;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={title ?? "Stepped demand and supply curves for this event's funded orders"}>
        <defs>
          <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#9AAE9F" strokeWidth="2" />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#9AAE9F" strokeWidth="1" strokeDasharray="2 4" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="mono" fontSize="11" fill="#52645D">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={H - pad.b} stroke="#064E3B" strokeWidth="2" />
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#064E3B" strokeWidth="2" />
        {!compact && (
          <>
            <text x={pad.l} y={H - 10} fontSize="11" fill="#52645D" className="mono">0</text>
            <text x={W - pad.r} y={H - 10} textAnchor="end" fontSize="11" fill="#52645D" className="mono">
              {maxQ.toFixed(0)} {baseSymbol}
            </text>
            <text x={(W + pad.l) / 2} y={H - 10} textAnchor="middle" fontSize="11" fill="#52645D">Cumulative quantity</text>
            <text x={14} y={pad.t + 4} fontSize="11" fill="#52645D" transform={`rotate(-90 14 ${pad.t + 4})`} textAnchor="end">
              Limit price ({quoteSymbol})
            </text>
          </>
        )}
        {!hasCross && bestBid !== null && bestAsk !== null && bestAsk > bestBid && (
          <g>
            <rect x={pad.l} width={W - pad.l - pad.r} y={y(bestAsk)} height={y(bestBid) - y(bestAsk)} fill="url(#hatch)" opacity="0.7" />
            <text x={(W + pad.l) / 2} y={(y(bestAsk) + y(bestBid)) / 2 + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#10251E">
              No executable price yet
            </text>
          </g>
        )}
        {buys.length > 0 && <path className="chart-line" d={steps(buys, lo)} fill="none" stroke="#10251E" strokeWidth="5" />}
        {buys.length > 0 && <path className="chart-line" d={steps(buys, lo)} fill="none" stroke="#8ED0B2" strokeWidth="3" />}
        {sells.length > 0 && <path className="chart-line" d={steps(sells, hi)} fill="none" stroke="#10251E" strokeWidth="5" />}
        {sells.length > 0 && <path className="chart-line" d={steps(sells, hi)} fill="none" stroke="#D9654F" strokeWidth="3" />}
        {hasCross && (
          <g className={animatePoint ? "point-in" : undefined}>
            <line x1={cx} x2={cx} y1={pad.t} y2={H - pad.b} stroke="#D5A62E" strokeWidth="3" />
            <line x1={pad.l} x2={W - pad.r} y1={cy} y2={cy} stroke="#D5A62E" strokeWidth="1.5" strokeDasharray="6 4" />
            <rect x={cx - 6} y={cy - 6} width="12" height="12" fill="#D5A62E" stroke="#10251E" strokeWidth="2" />
            <text x={Math.min(cx + 10, W - pad.r - 4)} y={cy - 10} fontSize="12" fontWeight="700" fill="#10251E" className="mono" textAnchor={cx > W - 170 ? "end" : "start"}>
              {formatAtoms(clearing.price, quoteDecimals, 4)} · {formatAtoms(clearing.volume, baseDecimals, 2)} {baseSymbol}
            </text>
          </g>
        )}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-1 w-5 border border-ink bg-mint" aria-hidden />Buy demand (bids, descending)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-1 w-5 border border-ink bg-coral" aria-hidden />Sell supply (asks, ascending)</span>
        {hasCross && <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-1 bg-amber" aria-hidden />Provisional clearing point</span>}
      </figcaption>
    </figure>
  );
}
