import { CONFIG } from "../../shared/config";
import { explorerAddr } from "../lib/chain";
import { Page } from "../components/Shell";
import { Copyable, Window } from "../components/ui";

const IX: [string, string][] = [
  ["create_auction(id, deadline, settle_by, min_base_qty, fee_bps, roster)", "Issuer creates one event for one base/quote pair, with base and quote escrow vaults and an approved participant list (up to 8, each with an order allowance)."],
  ["place_order(side, limit_price, qty)", "Approved participant locks quote (buy: qty × limit, rounded up) or base (sell: qty) into escrow before the deadline. Enforces minimum size, allowance, free slot and no self-trade."],
  ["cancel_order(slot)", "Order owner removes the order before the deadline; escrow is returned in the same transaction and the allowance slot is freed."],
  ["settle()", "Permissionless between the deadline and settle_by. Recomputes the clearing price onchain, validates the canonical owner token accounts passed as remaining accounts, and moves every fill, refund and fee in one transaction."],
  ["refund_expired(slot)", "Permissionless after settle_by if the event was never settled. Returns one order's escrow to its owner, subject to the token's transfer rules."],
];

export default function Developers() {
  return (
    <Page>
      <h1 className="m-0 text-[34px] leading-[38px] font-[650]">Program and accounts</h1>
      <p className="m-0 mt-2 max-w-[70ch] text-muted">Cleara is an Anchor program on Solana Devnet. Everything the app shows is read from these accounts through public RPC.</p>
      <div className="mt-6 grid grid-cols-2 gap-6 max-lg:grid-cols-1">
        <Window title="Deployment">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
            <dt className="text-muted">Program</dt><dd className="m-0"><Copyable value={CONFIG.programId} label={CONFIG.programId} /> · <a href={explorerAddr(CONFIG.programId)} target="_blank" rel="noreferrer" className="text-ink">Explorer ↗</a></dd>
            <dt className="text-muted">Cluster</dt><dd className="m-0">Solana Devnet</dd>
            <dt className="text-muted">Demo issuer</dt><dd className="m-0"><Copyable value={CONFIG.operator} /></dd>
            <dt className="text-muted">Quote token</dt><dd className="m-0">{CONFIG.quoteSymbol} (synthetic SPL token) <Copyable value={CONFIG.quoteMint} /></dd>
            {CONFIG.assets.map((a) => (
              <div key={a.mint} className="contents">
                <dt className="text-muted">{a.symbol}</dt><dd className="m-0">{a.kind}, Token-2022 with metadata <Copyable value={a.mint} /></dd>
              </div>
            ))}
          </dl>
        </Window>
        <Window title="Event account layout" id="accounts">
          <p className="mt-0 text-[13px]">One <span className="mono">Auction</span> PDA per event, seeds <span className="mono">["auction", issuer, id_le]</span>, about 1 KB. Vault PDAs: <span className="mono">["base_vault", auction]</span>, <span className="mono">["quote_vault", auction]</span>.</p>
          <ul className="m-0 flex flex-col gap-1 pl-5 text-[13px]">
            <li>Pair, decimals, fee account, fee in basis points</li>
            <li>deadline, settle_by, min_base_qty, status</li>
            <li>clearing_price, cleared_volume (after settlement)</li>
            <li>orders[8]: owner, side, limit_price, qty, escrowed, filled</li>
            <li>roster[8]: participant, allowance, active orders</li>
          </ul>
        </Window>
      </div>
      <div className="mt-6 flex flex-col gap-6">
        <Window title="Instructions" id="instructions" bodyClass="p-0">
          <table className="table">
            <tbody>
              {IX.map(([n, d]) => (
                <tr key={n}><td className="mono align-top">{n}</td><td>{d}</td></tr>
              ))}
            </tbody>
          </table>
        </Window>
        <Window title="Clearing rules" id="rules">
          <ol className="m-0 flex flex-col gap-1 pl-5 text-[14px]">
            <li>Candidate prices are the limits of the non-empty orders.</li>
            <li>For each candidate, demand = buys with limit ≥ price and supply = sells with limit ≤ price; matched volume = min(demand, supply).</li>
            <li>The price with the largest matched volume wins; ties go to the lowest price. Zero volume means no trade.</li>
            <li>Fills follow price priority; at the marginal price, the remaining volume is shared pro rata, and leftover smallest units go to lower slot numbers.</li>
            <li>Buyers pay fill × price rounded up; sellers receive it rounded down, minus the seller fee. Residue goes to the fee account.</li>
          </ol>
        </Window>
        <Window title="Security notes" id="security">
          <ul className="m-0 flex flex-col gap-1 pl-5 text-[14px]">
            <li>Settlement requires exactly one base and one quote canonical token account per active order, in slot order; missing, duplicated, reordered or substituted accounts are rejected.</li>
            <li>Vault balances must be zero after settlement, or the whole transaction reverts.</li>
            <li>Token-2022 mints with transfer fees, transfer hooks or other unsupported extensions are rejected at event creation.</li>
            <li>Frozen accounts make settlement fail atomically; per-order refunds let the other orders recover.</li>
            <li>Tested on a local validator: overlap, partial fill, no overlap, expiry refunds, input guards, account substitution, frozen accounts and the 8-order benchmark (about 1,009 bytes and 69k compute units).</li>
          </ul>
        </Window>
        <Window title="Legal and risk notice" id="risk">
          <p className="m-0 text-[14px]">This is hackathon software running on Solana Devnet with synthetic assets that have no value. It is not an offer to buy or sell any security, and it has not been audited. A real deployment would need issuer participation, eligibility checks and legal review for each asset and jurisdiction.</p>
        </Window>
      </div>
    </Page>
  );
}
