import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { CONFIG } from "../../shared/config";
import { SIDE_BUY, SIDE_SELL, clear } from "../../shared/cleara";
import { explorerAddr, fetchAuction, phaseOf, type AuctionView } from "../lib/chain";
import { useStore } from "../lib/store";
import { eventLabel, pair } from "../lib/format";
import { Page } from "../components/Shell";
import { DepthChart } from "../components/DepthChart";
import { Countdown, OrderBook, ProvisionalClearing, Rules } from "../components/EventParts";
import { MainnetComparison } from "../components/Jupiter";
import { CancelDialog, OrderDrawer } from "../components/OrderDrawer";
import { RefundPanel, SettlePanel, SettlementResult } from "../components/Settlement";
import { WalletDialog } from "../components/Wallet";
import { Copyable, Notice, PhaseBadge, SkeletonRows, SyntheticTag, Window } from "../components/ui";

function validAddress(s: string | undefined) {
  if (!s) return false;
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

export default function EventDetail() {
  const { address } = useParams();
  const { now, refresh: refreshAll } = useStore();
  const wallet = useWallet();
  const me = wallet.publicKey?.toBase58() ?? null;
  const [a, setA] = useState<AuctionView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<number | null>(null);
  const [cancelSlot, setCancelSlot] = useState<number | null>(null);
  const [connect, setConnect] = useState(false);

  const current = useRef(address);
  const load = useCallback(async () => {
    if (!validAddress(address)) {
      setA(null);
      return;
    }
    try {
      const next = await fetchAuction(address!);
      if (current.current !== address) return;
      setA(next);
      setError(null);
    } catch (e) {
      if (current.current !== address) return;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [address]);

  useEffect(() => {
    current.current = address;
    setA(undefined);
    setError(null);
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load, address]);

  const after = useCallback(() => {
    setTimeout(() => {
      load();
      refreshAll();
    }, 800);
  }, [load, refreshAll]);

  if (a === undefined)
    return (
      <Page>
        <Window title="Loading event">
          {error ? <Notice tone="danger" title="Could not load this event from Devnet">{error} <button type="button" className="btn btn-secondary btn-sm ml-2" onClick={load}>Retry</button></Notice> : <SkeletonRows rows={8} />}
        </Window>
      </Page>
    );
  if (a === null)
    return (
      <Page>
        <Window title="Event not found">
          <p className="mt-0">No Cleara event exists at this address on Solana Devnet.</p>
          <Link to="/events" className="btn btn-primary">Back to events</Link>
        </Window>
      </Page>
    );

  const phase = phaseOf(a, now);
  const clearing = phaseOf(a, now) === "expired" ? { price: 0n, volume: 0n, fills: a.orders.map(() => 0n) } : clear(a.orders);
  const sym = a.asset?.symbol ?? "";
  const open = phase === "open" || phase === "closing";
  const roster = me ? a.roster.find((r) => r.participant === me) : undefined;

  return (
    <Page>
      {error && <div className="mb-4"><Notice tone="danger" title="Could not refresh this event from Devnet">{error}</Notice></div>}
      <nav aria-label="Breadcrumb" className="mb-3 text-[13px]"><Link to="/events" className="text-ink">Events</Link> / <span className="text-muted">{eventLabel(a)}</span></nav>
      <div className="sticky top-[88px] z-30 -mx-2 mb-6 px-2 max-md:top-[84px]">
        <div className="window-bar rounded-[6px] border-2 border-emerald">
          <span className="flex-1 truncate">{eventLabel(a)} · {pair(a)}</span>
          <span className="hidden text-[12px] normal-case tracking-normal sm:inline"><Countdown a={a} now={now} /></span>
        </div>
      </div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <PhaseBadge phase={phase} />
            <SyntheticTag />
            <span className="label text-muted">Approved participants only</span>
          </div>
          <h1 className="m-0 text-[34px] leading-[38px] font-[650] max-sm:text-[26px] max-sm:leading-[30px]">{a.asset?.name ?? a.baseMint}</h1>
          <p className="m-0 mt-1 text-muted">{a.asset?.kind} · {a.asset?.description}</p>
          <p className="m-0 mt-1 text-[13px] text-muted">
            Event account <Copyable value={a.address} /> · <a href={explorerAddr(a.address)} target="_blank" rel="noreferrer" className="text-ink">Explorer ↗</a>
          </p>
        </div>
        <p className="m-0 text-[15px]"><Countdown a={a} now={now} /></p>
      </header>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8 flex flex-col gap-6 max-lg:col-span-12">
          {phase === "settled" && <SettlementResult a={a} me={me} />}
          {phase === "awaiting" && <SettlePanel a={a} now={now} onDone={after} onConnect={() => setConnect(true)} />}
          {phase === "expired" && <RefundPanel a={a} me={me} now={now} onDone={after} onConnect={() => setConnect(true)} />}
          <Window title={phase === "settled" ? "Order curves at settlement" : "Funded demand and supply"}>
            <DepthChart
              orders={a.orders}
              clearing={phase === "settled" ? { price: a.clearingPrice, volume: a.clearedVolume, fills: [] } : clearing}
              baseDecimals={a.baseDecimals}
              quoteDecimals={a.quoteDecimals}
              quoteSymbol={CONFIG.quoteSymbol}
              baseSymbol={sym}
            />
          </Window>
          <div className="lg:hidden flex flex-col gap-6">
            <ProvisionalClearing a={a} clearing={clearing} now={now} />
          </div>
          <OrderBook a={a} me={me} clearing={clearing} canCancel={open} onCancel={setCancelSlot} />
        </div>
        <aside className="col-span-4 flex flex-col gap-6 max-lg:col-span-12">
          <div className="max-lg:hidden"><ProvisionalClearing a={a} clearing={clearing} now={now} /></div>
          {open && (
            <Window title="Place an order">
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="btn btn-buy" onClick={() => setDrawer(SIDE_BUY)}>↑ Buy {sym}</button>
                  <button type="button" className="btn btn-sell" onClick={() => setDrawer(SIDE_SELL)}>↓ Sell {sym}</button>
                </div>
                <p className="m-0 text-[13px] text-muted">
                  {!me
                    ? "Connect a wallet to see your allowance. Only approved participants can place orders."
                    : roster
                      ? `You are approved. Order allowance left: ${roster.allowance - roster.active} of ${roster.allowance}.`
                      : "This wallet is not approved for this event. Start your own demo event from Events to take part."}
                </p>
                {me && !roster && <Link to="/events#demo" className="btn btn-secondary btn-sm">Start a demo event</Link>}
              </div>
            </Window>
          )}
          <Rules a={a} />
        </aside>
        {a.asset && (
          <div className="col-span-12">
            <MainnetComparison a={a} clearing={clearing} now={now} />
          </div>
        )}
      </div>
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 gap-2 border-t-2 border-emerald bg-cream p-3 lg:hidden">
          <button type="button" className="btn btn-buy" onClick={() => setDrawer(SIDE_BUY)}>↑ Buy</button>
          <button type="button" className="btn btn-sell" onClick={() => setDrawer(SIDE_SELL)}>↓ Sell</button>
        </div>
      )}
      {open && <div className="h-20 lg:hidden" aria-hidden />}
      {drawer !== null && <OrderDrawer a={a} initialSide={drawer} onClose={() => setDrawer(null)} onDone={after} />}
      {cancelSlot !== null && <CancelDialog a={a} slot={cancelSlot} onClose={() => setCancelSlot(null)} onDone={after} />}
      {connect && <WalletDialog onClose={() => setConnect(false)} />}
    </Page>
  );
}
