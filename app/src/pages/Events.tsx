import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { CONFIG } from "../../shared/config";
import { SCENARIOS, type ScenarioId } from "../../shared/scenarios";
import { isLegacy, phaseOf, type Phase } from "../lib/chain";
import { useStore } from "../lib/store";
import { requestDemoEvent } from "../lib/api";
import { Page } from "../components/Shell";
import { EventCard, phaseSortKey } from "../components/EventParts";
import { WalletDialog } from "../components/Wallet";
import { Notice, SkeletonRows, Window } from "../components/ui";

const FILTERS: { id: "all" | "open" | "awaiting" | "settled" | "expired"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "awaiting", label: "Awaiting settlement" },
  { id: "settled", label: "Settled" },
  { id: "expired", label: "Expired" },
];

const matches = (f: string, p: Phase) => f === "all" || f === p || (f === "open" && p === "closing");

export default function Events() {
  const { auctions, error, now, refresh, loading } = useStore();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const list = (auctions ?? [])
    .filter((a) => !isLegacy(a))
    .map((a) => ({ a, p: phaseOf(a, now) }))
    .filter((x) => matches(filter, x.p))
    .sort((x, y) => phaseSortKey(x.p) - phaseSortKey(y.p) || x.a.deadline - y.a.deadline);
  const featured = list.find((x) => x.p === "open" || x.p === "closing");

  return (
    <Page>
      <header className="mb-6 grid grid-cols-12 gap-6">
        <div className="col-span-7 max-lg:col-span-12">
          <h1 className="m-0 text-[34px] leading-[38px] font-[650]">Liquidity events</h1>
          <p className="m-0 mt-2 max-w-[62ch] text-muted">
            Each event trades one synthetic asset against {CONFIG.quoteSymbol}. Approved participants lock funded buy and sell limits until one deadline; then the event clears once at a single price. Everything here runs on Solana Devnet and is read live from the Cleara program.
          </p>
        </div>
        <Window title="How clearing works" className="col-span-5 max-lg:col-span-12" bodyClass="p-4">
          <ol className="m-0 flex flex-col gap-1 pl-5 text-[13px] leading-[18px]">
            <li>Buyers lock {CONFIG.quoteSymbol}; sellers lock tokens, each with a limit price.</li>
            <li>At the deadline, the program picks the price that matches the most volume.</li>
            <li>Matched orders trade at that one price; unmatched amounts are returned.</li>
          </ol>
        </Window>
      </header>

      <DemoStarter />

      <div role="tablist" aria-label="Filter events" className="mb-4 mt-8 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`btn btn-sm ${filter === f.id ? "btn-primary" : "btn-secondary"}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>

      {error && !auctions && (
        <Notice tone="danger" title="Could not load events from Solana Devnet">
          {error} <button type="button" className="btn btn-secondary btn-sm ml-2" onClick={() => refresh()}>Retry</button>
        </Notice>
      )}
      {!auctions && !error && <SkeletonRows rows={6} />}
      {auctions && list.length === 0 && (
        <Window title="No events">
          <p className="m-0">No events match this filter right now.</p>
        </Window>
      )}
      <div className="flex flex-col gap-6">
        {featured && filter === "all" && <EventCard a={featured.a} now={now} featured />}
        <div className="grid grid-cols-2 gap-6 max-lg:grid-cols-1">
          {list.filter((x) => !(featured && filter === "all" && x.a.address === featured.a.address)).map((x) => (
            <EventCard key={x.a.address} a={x.a} now={now} />
          ))}
        </div>
      </div>
    </Page>
  );
}

function DemoStarter() {
  const wallet = useWallet();
  const navigate = useNavigate();
  const [scenario, setScenario] = useState<ScenarioId>("crossing");
  const [asset, setAsset] = useState(CONFIG.assets[0].mint);
  const [st, setSt] = useState<{ kind: "idle" | "busy" } | { kind: "error"; msg: string }>({ kind: "idle" });
  const [connect, setConnect] = useState(false);
  return (
    <Window id="demo" title="Try it · start your own 4-minute demo event" active>
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-5 max-lg:col-span-12">
          <p className="m-0">
            Cleara creates a fresh synthetic event on Devnet with four labelled demo bots and your wallet on the approved list, sends your wallet synthetic tokens and a little devnet SOL, and opens it for 4 minutes. Place an order, watch the provisional price, then settle it yourself.
          </p>
        </div>
        <div className="col-span-7 flex flex-col gap-3 max-lg:col-span-12">
          <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
            <legend className="mb-1 label text-muted">Starting order book</legend>
            {Object.values(SCENARIOS).map((s) => (
              <label key={s.id} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[4px] border-2 px-3 ${scenario === s.id ? "border-emerald bg-mint-pale" : "border-line bg-cream"}`}>
                <input type="radio" name="scenario" value={s.id} checked={scenario === s.id} onChange={() => setScenario(s.id)} />
                <span className="text-[14px] font-semibold">{s.title}</span>
              </label>
            ))}
          </fieldset>
          <p className="m-0 text-[13px] text-muted">{SCENARIOS[scenario].summary}</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[220px] flex-1">
              <span className="label text-muted">Synthetic asset</span>
              <select className="field mt-1 font-sans" value={asset} onChange={(e) => setAsset(e.target.value)}>
                {CONFIG.assets.map((a) => <option key={a.mint} value={a.mint}>{a.symbol} · {a.name}</option>)}
              </select>
            </label>
            {wallet.publicKey ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={st.kind === "busy"}
                onClick={async () => {
                  setSt({ kind: "busy" });
                  try {
                    const r = await requestDemoEvent(wallet.publicKey!.toBase58(), asset, scenario);
                    navigate(`/events/${r.auction}`);
                  } catch (e) {
                    setSt({ kind: "error", msg: e instanceof Error ? e.message : String(e) });
                  }
                }}
              >
                {st.kind === "busy" ? "Creating on Devnet…" : "Start demo event"}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setConnect(true)}>Connect wallet to start</button>
            )}
          </div>
          <div aria-live="polite">
            {st.kind === "busy" && <p className="m-0 text-[13px] text-muted">Creating the event, funding your wallet and placing the bots' orders. This takes 10–30 seconds on public Devnet.</p>}
            {st.kind === "error" && <Notice tone="danger" title="Could not create the demo event">{st.msg}</Notice>}
          </div>
        </div>
      </div>
      {connect && <WalletDialog onClose={() => setConnect(false)} />}
    </Window>
  );
}
