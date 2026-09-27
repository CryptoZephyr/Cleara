import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { CONFIG } from "../../shared/config";
import { SIDE_BUY } from "../../shared/cleara";
import { activeOrders, explainError, explorerAddr, explorerTx, latestSignature, phaseOf, refundIxs, sendIxs, settleIxs, type AuctionView } from "../lib/chain";
import { dateTime, fmtBase, fmtPrice, fmtQuote } from "../lib/format";
import { IconExternal } from "./icons";
import { Allocation, personalResult } from "./EventParts";
import { Copyable, Notice, SideTag, Window } from "./ui";

type Act = { kind: "idle" } | { kind: "busy"; what: string } | { kind: "ok"; what: string; sig: string } | { kind: "error"; what: string; msg: string };

export function useAction() {
  const wallet = useWallet();
  const [act, setAct] = useState<Act>({ kind: "idle" });
  async function run(what: string, build: () => Promise<Parameters<typeof sendIxs>[1]>, after: () => void) {
    setAct({ kind: "busy", what });
    try {
      const sig = await sendIxs(wallet, await build());
      setAct({ kind: "ok", what, sig });
      after();
    } catch (e) {
      setAct({ kind: "error", what, msg: explainError(e) });
    }
  }
  return { act, run, connected: !!wallet.publicKey };
}

export function ActionStatus({ act }: { act: Act }) {
  return (
    <div aria-live="polite">
      {act.kind === "busy" && <Notice tone="info" title={`${act.what}…`}>Waiting for your wallet and Devnet confirmation.</Notice>}
      {act.kind === "ok" && (
        <Notice tone="ok" title={`${act.what} confirmed`}>
          <a href={explorerTx(act.sig)} target="_blank" rel="noreferrer" className="text-ink">View transaction ↗</a>
        </Notice>
      )}
      {act.kind === "error" && <Notice tone="danger" title={`${act.what} failed`}>{act.msg}</Notice>}
    </div>
  );
}

/** Shown after the deadline and before settlement: anyone can trigger the all-or-nothing settlement. */
export function SettlePanel({ a, now, onDone, onConnect }: { a: AuctionView; now: number; onDone: () => void; onConnect: () => void }) {
  const { act, run, connected } = useAction();
  return (
    <Window title="Order window closed · ready to settle" active>
      <div className="flex flex-col gap-3">
        <p className="m-0">The order deadline passed at {dateTime(a.deadline)}. Anyone can now trigger settlement until {dateTime(a.settleBy)}. It computes the clearing price onchain and moves every matched and unmatched amount in one transaction.</p>
        {connected ? (
          <button type="button" className="btn btn-primary" disabled={act.kind === "busy" || now < a.deadline} onClick={() => run("Settlement", () => settleIxs(a), onDone)}>
            Settle event now
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onConnect}>Connect wallet to settle</button>
        )}
        <ActionStatus act={act} />
      </div>
    </Window>
  );
}

export function SettlementResult({ a, me }: { a: AuctionView; me: string | null }) {
  const [sig, setSig] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    latestSignature(a.address).then(setSig).catch(() => setSig(null));
  }, [a.address]);
  const sym = a.asset?.symbol ?? "";
  const orders = activeOrders(a);
  const filled = orders.filter((o) => o.filled > 0n);
  const outcome = a.clearedVolume === 0n ? "No overlap" : filled.some((o) => o.filled < o.qty) ? "Partial fill" : "Full match";
  const mine = orders.filter((o) => o.owner === me);
  return (
    <div className="flex flex-col gap-6">
      <Window title={`Settlement result · ${outcome}`} active bodyClass="p-0">
        <div className="stamp h-1 origin-left bg-amber" aria-hidden />
        <div className="grid gap-4 p-5 sm:grid-cols-3 max-sm:p-4">
          <div>
            <p className="m-0 label text-muted">Clearing price</p>
            <p className="m-0 mono text-[30px] leading-[34px]">{a.clearedVolume > 0n ? fmtPrice(a, a.clearingPrice) : "—"}</p>
            <p className="m-0 text-[13px] text-muted">{CONFIG.quoteSymbol} per {sym}</p>
          </div>
          <div>
            <p className="m-0 label text-muted">Matched volume</p>
            <p className="m-0 mono text-[30px] leading-[34px]">{fmtBase(a, a.clearedVolume)}</p>
            <p className="m-0 text-[13px] text-muted">{sym} · {filled.length} of {orders.length} orders filled</p>
          </div>
          <div>
            <p className="m-0 label text-muted">Settlement transaction</p>
            {sig ? (
              <a href={explorerTx(sig)} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-1 mono text-[13px] text-ink">
                {sig.slice(0, 8)}…{sig.slice(-6)} <IconExternal size={12} />
              </a>
            ) : sig === null ? (
              <a href={explorerAddr(a.address)} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-1 text-[13px] text-ink">View event account ↗</a>
            ) : (
              <p className="m-0 text-[13px] text-muted">Looking up…</p>
            )}
            <p className="m-0 text-[13px] text-muted">One all-or-nothing transaction on Solana Devnet.</p>
          </div>
        </div>
        <div className="border-t-2 border-emerald">
          <Allocation a={a} me={me} />
        </div>
        <p className="m-0 border-t border-line px-5 py-3 text-[13px] text-muted max-sm:px-4">
          Allocation rule: price priority, then pro rata at the marginal price; leftover units go to lower slot numbers. Buyers pay the clearing price rounded up to the smallest unit; sellers receive it rounded down, minus the {(a.feeBps / 100).toFixed(2)}% seller fee. Rounding residue goes to the fee account. Partial fills are a normal outcome.
        </p>
      </Window>
      {mine.map((o) => {
        const r = personalResult(a, o.slot);
        return (
          <Window key={o.slot} title={`Your receipt · order #${o.slot + 1}`} active className="max-w-[560px]">
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-muted">Side</dt><dd className="m-0"><SideTag side={o.side} /></dd>
              <dt className="text-muted">Limit · quantity</dt><dd className="m-0 mono">{fmtPrice(a, o.limitPrice)} · {fmtBase(a, o.qty)} {sym}</dd>
              <dt className="text-muted">Filled</dt><dd className="m-0 mono">{fmtBase(a, r.filled)} {sym}</dd>
              {o.side === SIDE_BUY ? (
                <>
                  <dt className="text-muted">Paid</dt><dd className="m-0 mono">{fmtQuote(a, r.paid)} {CONFIG.quoteSymbol}</dd>
                  <dt className="text-muted">Returned</dt><dd className="m-0 mono">{fmtQuote(a, r.refundQuote)} {CONFIG.quoteSymbol}</dd>
                </>
              ) : (
                <>
                  <dt className="text-muted">Received</dt><dd className="m-0 mono">{fmtQuote(a, r.received)} {CONFIG.quoteSymbol}</dd>
                  <dt className="text-muted">Fee</dt><dd className="m-0 mono">{fmtQuote(a, r.fee)} {CONFIG.quoteSymbol}</dd>
                  <dt className="text-muted">Returned</dt><dd className="m-0 mono">{fmtBase(a, r.refundBase)} {sym}</dd>
                </>
              )}
              <dt className="text-muted">Event account</dt><dd className="m-0"><Copyable value={a.address} /></dd>
              <dt className="text-muted">Network</dt><dd className="m-0">Solana Devnet · synthetic assets</dd>
            </dl>
          </Window>
        );
      })}
    </div>
  );
}

export function RefundPanel({ a, me, now, onDone, onConnect }: { a: AuctionView; me: string | null; now: number; onDone: () => void; onConnect: () => void }) {
  const { act, run, connected } = useAction();
  const orders = activeOrders(a);
  const sym = a.asset?.symbol ?? "";
  const expired = phaseOf(a, now) === "expired";
  return (
    <Window title="Recovery · expired event" active>
      <div className="flex flex-col gap-3">
        <p className="m-0">
          Nobody settled this event before {dateTime(a.settleBy)}, so nothing traded. Anyone can now return each order's escrow to its owner, one order at a time, so one blocked account cannot hold up the others. Refunds remain subject to the token's transfer rules.
        </p>
        {orders.length === 0 ? (
          <Notice tone="ok" title="All orders have been refunded">No escrow remains in this event.</Notice>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {orders.map((o) => (
              <li key={o.slot} className="flex flex-wrap items-center gap-3 rounded-[4px] border border-line p-2">
                <SideTag side={o.side} />
                <span className="mono text-[13px]">#{o.slot + 1}</span>
                <span className="text-[13px]">{o.owner === me ? "You" : `Owner ${o.owner.slice(0, 4)}…`}</span>
                <span className="mono ml-auto text-[13px]">{o.side === SIDE_BUY ? `${fmtQuote(a, o.escrowed)} ${CONFIG.quoteSymbol}` : `${fmtBase(a, o.escrowed)} ${sym}`}</span>
                {connected ? (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={!expired || act.kind === "busy"} onClick={() => run(`Refund of order #${o.slot + 1}`, () => refundIxs(a, o.slot), onDone)}>
                    Refund to owner
                  </button>
                ) : (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onConnect}>Connect to refund</button>
                )}
              </li>
            ))}
          </ul>
        )}
        <ActionStatus act={act} />
      </div>
    </Window>
  );
}
