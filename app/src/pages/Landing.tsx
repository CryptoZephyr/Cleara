import { useState } from "react";
import { Link } from "react-router-dom";
import { CONFIG } from "../../shared/config";
import { SIDE_EMPTY, clear, formatAtoms, parseAtoms, type BookOrder } from "../../shared/cleara";
import { SCENARIOS, type ScenarioId } from "../../shared/scenarios";
import { DepthChart } from "../components/DepthChart";
import { SideTag, Window } from "../components/ui";

const DEC = 6;

function scenarioBook(id: ScenarioId | "recovery"): BookOrder[] {
  const src = id === "recovery" ? SCENARIOS.crossing : SCENARIOS[id];
  const orders: BookOrder[] = src.orders.map((o, slot) => ({
    slot,
    owner: `bot${o.bot}`,
    side: o.side,
    limitPrice: parseAtoms(o.price, DEC)!,
    qty: parseAtoms(o.qty, DEC)!,
    escrowed: 0n,
    filled: 0n,
  }));
  while (orders.length < 8) orders.push({ slot: orders.length, owner: "", side: SIDE_EMPTY, limitPrice: 0n, qty: 0n, escrowed: 0n, filled: 0n });
  return orders;
}

const PREVIEW: { id: ScenarioId | "recovery"; title: string; body: string }[] = [
  { id: "crossing", title: "Crossing orders", body: "Buy and sell limits overlap. Every matched order trades at the one price that matches the most volume." },
  { id: "partial", title: "Partial fill", body: "More tokens are offered than buyers want. Sellers at the marginal price are filled pro rata; the rest is returned." },
  { id: "no-overlap", title: "No overlap", body: "Every buyer's limit is below every seller's limit. Nothing trades and every order is returned in full." },
  { id: "recovery", title: "Recovery after expiry", body: "If nobody settles before the settlement deadline, anyone can return each order's escrow to its owner, subject to the token's transfer rules." },
];

function HeroVisual() {
  const book = scenarioBook("crossing");
  const c = clear(book);
  return (
    <Window title="EVENT NRTH-DEMO · NRTH / dUSDC" active right={<span className="label">Synthetic example</span>} bodyClass="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 text-[13px]">
        <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-devnet px-2 py-0.5 label text-cream">Devnet</span>
        <span className="mono">Deadline Fri 16:00 UTC · illustrative</span>
      </div>
      <div className="p-4">
        <DepthChart orders={book} clearing={c} baseDecimals={DEC} quoteDecimals={DEC} quoteSymbol="dUSDC" baseSymbol="NRTH" height={240} title="Synthetic example: stepped demand and supply curves crossing at one price" />
      </div>
      <div className="grid grid-cols-2 border-t-2 border-emerald">
        <div className="border-r-2 border-emerald p-4">
          <p className="m-0 label text-muted">Provisional clearing price</p>
          <p className="m-0 mono text-[26px] leading-[32px]">{formatAtoms(c.price, DEC, 4)}</p>
          <p className="m-0 text-[12px] text-muted">dUSDC per NRTH · may change until the deadline</p>
        </div>
        <div className="p-4">
          <p className="m-0 label text-muted">Executable quantity</p>
          <p className="m-0 mono text-[26px] leading-[32px]">{formatAtoms(c.volume, DEC, 2)}</p>
          <p className="m-0 text-[12px] text-muted">NRTH from 4 funded orders</p>
        </div>
      </div>
    </Window>
  );
}

function MechanismPreview() {
  const [tab, setTab] = useState<(typeof PREVIEW)[number]["id"]>("crossing");
  const book = scenarioBook(tab);
  const c = tab === "recovery" ? { price: 0n, volume: 0n, fills: book.map(() => 0n) } : clear(book);
  const cur = PREVIEW.find((p) => p.id === tab)!;
  return (
    <Window title="Mechanism preview · synthetic orders" active bodyClass="p-0">
      <div role="tablist" aria-label="Scenario" className="flex flex-wrap gap-2 border-b-2 border-emerald bg-champagne/60 p-3">
        {PREVIEW.map((p) => (
          <button key={p.id} role="tab" type="button" aria-selected={tab === p.id} className={`btn btn-sm ${tab === p.id ? "btn-primary" : "btn-secondary"}`} onClick={() => setTab(p.id)}>
            {p.title}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-12 gap-6 p-5 max-sm:p-4">
        <div className="col-span-7 max-lg:col-span-12">
          <DepthChart orders={book} clearing={c} baseDecimals={DEC} quoteDecimals={DEC} quoteSymbol="dUSDC" baseSymbol="NRTH" height={260} />
        </div>
        <div className="col-span-5 flex flex-col gap-3 max-lg:col-span-12" aria-live="polite">
          <p className="m-0 text-[17px] font-semibold">{cur.title}</p>
          <p className="m-0 text-muted">{cur.body}</p>
          <table className="table">
            <thead><tr><th scope="col">Side</th><th scope="col" className="text-right">Limit</th><th scope="col" className="text-right">Qty</th><th scope="col" className="text-right">{tab === "recovery" ? "Returned" : "Filled"}</th></tr></thead>
            <tbody>
              {book.filter((o) => o.side !== SIDE_EMPTY).map((o) => (
                <tr key={o.slot}>
                  <td><SideTag side={o.side} /></td>
                  <td className="mono text-right">{formatAtoms(o.limitPrice, DEC, 2)}</td>
                  <td className="mono text-right">{formatAtoms(o.qty, DEC, 2)}</td>
                  <td className="mono text-right">{tab === "recovery" ? "All" : formatAtoms(c.fills[o.slot], DEC, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="m-0 mono text-[13px]">
            {tab === "recovery" ? "Nothing traded · escrow refundable per order" : c.volume > 0n ? `Clears at ${formatAtoms(c.price, DEC, 4)} dUSDC · ${formatAtoms(c.volume, DEC, 2)} NRTH matched` : "No executable price · all orders returned"}
          </p>
        </div>
      </div>
    </Window>
  );
}

const FAQ: [string, string][] = [
  ["Does Cleara guarantee I can sell?", "No. Cleara only brings existing funded orders into one scheduled event. If buy and sell limits do not overlap at the deadline, nothing trades and every order is returned."],
  ["Are orders private?", "No. Every order's side, limit price and quantity is stored unencrypted in the event account and can be read by anyone through Solana RPC. The app shows the same public book."],
  ["How is the clearing price chosen?", "The program checks each order's limit as a candidate price and picks the one that matches the most volume, breaking ties toward the lowest price. Everyone who trades pays or receives that one price."],
  ["What if more is offered than bought?", "Orders with better limits fill first. At the marginal price, fills are shared pro rata and leftover units go to lower slot numbers. The unfilled part is returned at settlement."],
  ["What happens if settlement never happens?", "After the settlement window ends, anyone can refund each order's escrow to its owner, one order at a time. Refunds remain subject to the asset's transfer rules."],
  ["Why only eight orders?", "So the whole event settles in one all-or-nothing transaction. Approved participants and per-participant allowances stop one wallet from filling every slot."],
  ["Is anything here real?", "No. The assets, participants and quote token are synthetic and run on Solana Devnet. Only the Jupiter comparison uses a real mainnet quote, and it is labelled separately."],
];

export default function Landing() {
  return (
    <>
      <section className="border-b-2 border-emerald bg-champagne">
        <div className="mx-auto grid max-w-[1344px] grid-cols-12 gap-8 px-8 py-16 max-lg:py-10 max-md:px-4">
          <div className="col-span-6 flex flex-col justify-center gap-5 max-lg:col-span-12">
            <p className="m-0 label text-devnet">Synthetic assets · Solana Devnet</p>
            <h1 className="m-0 text-[56px] leading-[60px] font-[650] tracking-[-0.03em] max-sm:text-[40px] max-sm:leading-[44px]">A clear moment to exit.</h1>
            <p className="m-0 max-w-[48ch] text-[19px] leading-[28px] text-muted">Scheduled liquidity events for hard-to-sell tokenized assets.</p>
            <p className="m-0 max-w-[56ch]">
              Cleara brings funded buy and sell orders for one asset into a single event with one deadline, applies published rules, and shows exactly what cleared, what did not, and what is refundable.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/events" className="btn btn-primary">Explore events</Link>
              <Link to="/#how" className="btn btn-secondary">How clearing works</Link>
            </div>
          </div>
          <div className="col-span-6 max-lg:col-span-12"><HeroVisual /></div>
        </div>
      </section>

      <main className="mx-auto flex max-w-[1344px] flex-col gap-20 px-8 py-16 max-md:gap-12 max-md:px-4 max-md:py-10">
        <section aria-labelledby="problem" className="grid grid-cols-12 gap-8">
          <div className="col-span-5 max-lg:col-span-12">
            <p className="m-0 label text-muted">The liquidity problem</p>
            <h2 id="problem" className="m-0 mt-2 text-[34px] leading-[38px] font-[650]">Thin assets rarely have buyers and sellers at the same time.</h2>
          </div>
          <div className="col-span-7 grid grid-cols-3 gap-4 max-md:grid-cols-1 max-lg:col-span-12">
            {[
              ["Interest is scattered", "A holder wants out on Tuesday; a buyer shows up on Friday. Neither finds the other in an empty order book."],
              ["Instant exits are costly", "Selling into a shallow pool can move the price a lot, especially for private-company, credit and fund tokens."],
              ["Results are hard to audit", "Off-venue matches rarely show who was eligible, which orders counted, or why a price was chosen."],
            ].map(([t, b]) => (
              <div key={t} className="rounded-[6px] border-2 border-emerald bg-cream p-4">
                <p className="m-0 font-semibold">{t}</p>
                <p className="m-0 mt-2 text-[14px] text-muted">{b}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how" aria-labelledby="how-title" className="scroll-mt-28">
          <p className="m-0 label text-muted">How a Cleara event works</p>
          <h2 id="how-title" className="m-0 mt-2 text-[34px] leading-[38px] font-[650]">Three steps, one deadline, one price.</h2>
          <ol className="m-0 mt-6 grid list-none grid-cols-3 gap-6 p-0 max-lg:grid-cols-1">
            {[
              ["01", "Lock a limit order", `Approved participants lock ${CONFIG.quoteSymbol} to buy or tokens to sell, each with a limit price, before the order deadline. Orders can be cancelled until then.`],
              ["02", "Clear at one price", "After the deadline, the program checks every limit and picks the price that matches the most volume. Every matched order uses that one price."],
              ["03", "Settle or recover", "One all-or-nothing transaction pays sellers, delivers tokens to buyers and returns everything unmatched. If nobody settles in time, each order can be refunded."],
            ].map(([n, t, b]) => (
              <li key={n} className="window">
                <div className="window-bar"><span className="mono">{n}</span><span>{t}</span></div>
                <p className="m-0 p-4 text-[14px]">{b}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="Mechanism preview"><MechanismPreview /></section>

        <section id="about" aria-labelledby="who" className="grid grid-cols-12 gap-8 scroll-mt-28">
          <div className="col-span-5 max-lg:col-span-12">
            <p className="m-0 label text-muted">Who Cleara is for</p>
            <h2 id="who" className="m-0 mt-2 text-[34px] leading-[38px] font-[650]">Built around the issuer's own participants.</h2>
          </div>
          <div className="col-span-7 grid grid-cols-3 gap-4 max-md:grid-cols-1 max-lg:col-span-12">
            {[
              ["Issuers and platforms", "Run recurring, rule-based liquidity windows for one asset, with an approved participant list and published terms."],
              ["Holders", "Offer tokens at a minimum price and see exactly what filled, what was returned and why."],
              ["Buyers and market makers", "Commit funded bids for a known deadline instead of watching an empty order book."],
            ].map(([t, b]) => (
              <div key={t} className="rounded-[6px] border-2 border-emerald bg-cream p-4">
                <p className="m-0 font-semibold">{t}</p>
                <p className="m-0 mt-2 text-[14px] text-muted">{b}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="trust">
          <Window title="Trust and boundaries" bodyClass="grid grid-cols-2 gap-8 p-6 max-md:grid-cols-1 max-sm:p-4">
            <div>
              <h2 id="trust" className="m-0 text-[22px] leading-[28px] font-semibold">What the program guarantees</h2>
              <ul className="m-0 mt-3 flex flex-col gap-2 pl-5 text-[14px]">
                <li>The clearing price is recomputed onchain from the stored order book.</li>
                <li>Settlement is all-or-nothing: every transfer succeeds, or none do.</li>
                <li>Buyers never pay above their limit; sellers never receive below theirs.</li>
                <li>Unmatched amounts are returned at settlement or refundable after expiry.</li>
                <li>Only approved participants can place orders, within an allowance.</li>
              </ul>
            </div>
            <div>
              <h2 className="m-0 text-[22px] leading-[28px] font-semibold">What it does not do</h2>
              <ul className="m-0 mt-3 flex flex-col gap-2 pl-5 text-[14px]">
                <li>It does not create buyers or guarantee that anything trades.</li>
                <li>It does not hide orders; the book is public onchain.</li>
                <li>It does not certify that the clearing price reflects an asset's value.</li>
                <li>It cannot override an issuer's freeze or transfer restrictions.</li>
                <li>This deployment uses synthetic assets on Devnet only.</li>
              </ul>
            </div>
          </Window>
        </section>

        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-28">
          <p className="m-0 label text-muted">FAQ</p>
          <h2 id="faq-title" className="m-0 mt-2 mb-6 text-[34px] leading-[38px] font-[650]">Plain answers.</h2>
          <div className="flex flex-col gap-3">
            {FAQ.map(([q, a]) => (
              <details key={q} className="window group">
                <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 px-4 font-semibold">
                  {q}
                  <span className="mono text-[18px] group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <p className="m-0 border-t border-line px-4 py-3 text-[14px] text-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="rounded-[6px] border-2 border-emerald bg-emerald p-10 text-champagne shadow-[4px_4px_0_#10251E] max-sm:p-6">
          <h2 className="m-0 text-[34px] leading-[38px] font-[650]">See a live synthetic event.</h2>
          <p className="m-0 mt-3 max-w-[60ch] text-champagne/85">Browse open, settled and expired events on Devnet, or start your own 4-minute demo event and settle it yourself.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/events" className="btn btn-secondary">Explore events</Link>
            <Link to="/events#demo" className="btn btn-secondary">Start a demo event</Link>
          </div>
        </section>
      </main>
    </>
  );
}
