import { useCallback, useEffect, useState } from "react";
import { CONFIG, type AssetConfig } from "../../shared/config";
import { formatAtoms, parseAtoms, type Clearing } from "../../shared/cleara";
import type { AuctionView } from "../lib/chain";
import { fmtBase, fmtPrice } from "../lib/format";
import { NetBadge, Notice, Stat, Window } from "./ui";
import { Countdown, depth } from "./EventParts";

interface Quote {
  outAmount: string;
  priceImpactPct: string;
  routePlan: { swapInfo: { label?: string } }[];
}

type QState = { kind: "idle" } | { kind: "loading" } | { kind: "ok"; q: Quote; at: Date; amount: string } | { kind: "none"; msg: string } | { kind: "error"; msg: string };

export function MainnetComparison({ a, clearing, now }: { a: AuctionView; clearing: Clearing; now: number }) {
  const ref = (a.asset as AssetConfig).reference;
  const [amount, setAmount] = useState("5");
  const [st, setSt] = useState<QState>({ kind: "idle" });
  const atoms = parseAtoms(amount, ref.decimals);

  const load = useCallback(async (amt: string) => {
    const at = parseAtoms(amt, ref.decimals);
    if (!at || at === 0n) return;
    setSt({ kind: "loading" });
    try {
      const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${ref.mint}&outputMint=${CONFIG.usdcMainnet}&amount=${at}&slippageBps=50`;
      const res = await fetch(url);
      const data = (await res.json()) as Quote & { error?: string; errorCode?: string };
      if (!res.ok || data.error) {
        setSt({ kind: "none", msg: data.error ?? `Jupiter returned ${res.status}` });
        return;
      }
      setSt({ kind: "ok", q: data, at: new Date(), amount: amt });
    } catch (e) {
      setSt({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
    }
  }, [ref.decimals, ref.mint]);

  useEffect(() => {
    load("5");
  }, [load]);

  const d = depth(a);
  const sym = a.asset?.symbol ?? "";
  return (
    <Window title="Sell now or join the event" bodyClass="p-0">
      <div className="border-b border-line px-5 py-3 text-[13px] text-muted max-sm:px-4">
        These values come from different networks and are shown for comparison only. {ref.symbol} is a real tokenized stock on Solana mainnet used as a reference for thin tokenized-asset liquidity; it is not the synthetic {sym} asset in this event.
      </div>
      <div className="grid gap-0 md:grid-cols-2">
        <div className="flex flex-col gap-3 border-b-2 border-emerald p-5 md:border-r-2 md:border-b-0 max-sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <NetBadge net="mainnet" />
            <span className="text-[12px] text-muted">Jupiter · {ref.name}</span>
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              load(amount);
            }}
          >
            <label className="flex-1">
              <span className="label text-muted">Sell amount ({ref.symbol})</span>
              <input className="field mt-1" inputMode="decimal" value={amount} aria-invalid={!atoms} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-secondary" disabled={!atoms || st.kind === "loading"}>
              {st.kind === "loading" ? "Quoting…" : "Get quote"}
            </button>
          </form>
          <div aria-live="polite">
            {st.kind === "ok" && (
              <div className="flex flex-col gap-3">
                <Stat big label="Estimated proceeds now" value={`${formatAtoms(BigInt(st.q.outAmount), 6, 2)} USDC`} sub={`for ${st.amount} ${ref.symbol}`} />
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Price impact" value={`${(Number(st.q.priceImpactPct) * 100).toFixed(3)}%`} />
                  <Stat label="Route" value={st.q.routePlan.map((r) => r.swapInfo.label ?? "pool").join(" → ") || "—"} />
                </div>
                <p className="m-0 text-[12px] text-muted">
                  Quoted {st.at.toLocaleTimeString()} with 0.5% slippage tolerance. Pool fees are included in the estimate. Quotes expire within seconds and are not guaranteed.
                </p>
              </div>
            )}
            {st.kind === "none" && <Notice tone="warn" title="Quote unavailable">Jupiter could not find a route for this amount. The Cleara event remains available. ({st.msg})</Notice>}
            {st.kind === "error" && <Notice tone="danger" title="Could not reach Jupiter">{st.msg}</Notice>}
          </div>
        </div>
        <div className="flex flex-col gap-3 p-5 max-sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <NetBadge net="devnet" />
            <span className="text-[12px] text-muted">Cleara · synthetic {sym}</span>
          </div>
          <Stat
            big
            label={a.status === 1 ? "Clearing price" : "Provisional clearing price"}
            value={
              a.status === 1
                ? a.clearedVolume > 0n ? `${fmtPrice(a, a.clearingPrice)} ${CONFIG.quoteSymbol}` : "No overlap"
                : clearing.volume > 0n ? `${fmtPrice(a, clearing.price)} ${CONFIG.quoteSymbol}` : "No executable price yet"
            }
            sub={`per ${sym}`}
          />
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Funded bids" value={`${fmtBase(a, d.buyQty)} ${sym}`} />
            <Stat label="Funded asks" value={`${fmtBase(a, d.sellQty)} ${sym}`} />
          </div>
          <p className="m-0 text-[13px]"><Countdown a={a} now={now} /></p>
          <p className="m-0 text-[12px] text-muted">A limit order only executes at or better than its limit, and only if enough funded interest overlaps at the deadline.</p>
        </div>
      </div>
    </Window>
  );
}
