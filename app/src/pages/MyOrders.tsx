import { Link } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { SIDE_BUY, SIDE_EMPTY } from "../../shared/cleara";
import { phaseOf, quoteSym, type AuctionView, type Phase } from "../lib/chain";
import { useStore } from "../lib/store";
import { eventLabel, fmtBase, fmtPrice, fmtQuote, pair } from "../lib/format";
import { Page } from "../components/Shell";
import { personalResult } from "../components/EventParts";
import { WalletDialog } from "../components/Wallet";
import { PhaseBadge, SideTag, SkeletonRows, Window } from "../components/ui";

function refundState(p: Phase): string {
  if (p === "settled") return "Settled";
  if (p === "expired") return "Available";
  return "Not available yet";
}

export default function MyOrders() {
  const { publicKey } = useWallet();
  const { auctions, now } = useStore();
  const [connect, setConnect] = useState(false);
  const me = publicKey?.toBase58() ?? null;
  if (!me)
    return (
      <Page>
        <h1 className="m-0 mb-6 text-[34px] leading-[38px] font-[650]">My orders</h1>
        <Window title="Wallet not connected">
          <p className="mt-0">Connect a Devnet wallet to see its orders, fills and refundable escrow across Cleara events.</p>
          <button type="button" className="btn btn-primary" onClick={() => setConnect(true)}>Connect wallet</button>
          {connect && <WalletDialog onClose={() => setConnect(false)} />}
        </Window>
      </Page>
    );
  const rows = (auctions ?? []).flatMap((a) => a.orders.filter((o) => o.side !== SIDE_EMPTY && o.owner === me).map((o) => ({ a, o, p: phaseOf(a, now) })));
  const approved = (auctions ?? []).filter((a) => a.roster.some((r) => r.participant === me) && !rows.some((x) => x.a.address === a.address));
  return (
    <Page>
      <h1 className="m-0 mb-2 text-[34px] leading-[38px] font-[650]">My orders</h1>
      <p className="m-0 mb-6 text-[13px] text-muted">Shows orders currently stored in event accounts. A refund or cancellation clears the slot onchain, so that order leaves this list; its transactions remain visible on Solana Explorer.</p>
      {!auctions ? (
        <SkeletonRows rows={4} />
      ) : rows.length === 0 ? (
        <Window title="No orders yet">
          <p className="mt-0">This wallet has no orders in any Cleara event. Orders you place appear here with their fill and refund status.</p>
          <Link to="/events#demo" className="btn btn-primary">Start a demo event</Link>
        </Window>
      ) : (
        <Window title={`${rows.length} order${rows.length === 1 ? "" : "s"}`} bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="table min-w-[860px]">
              <thead>
                <tr>
                  <th scope="col">Event</th><th scope="col">Status</th><th scope="col">Side</th>
                  <th scope="col" className="text-right">Limit</th><th scope="col" className="text-right">Quantity</th>
                  <th scope="col" className="text-right">Filled</th><th scope="col">Escrow / result</th><th scope="col">Refund</th><th scope="col"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ a, o, p }) => <Row key={a.address + o.slot} a={a} slot={o.slot} p={p} />)}
              </tbody>
            </table>
          </div>
        </Window>
      )}
      {approved.length > 0 && (
        <div className="mt-6">
          <Window title="Events you're approved for">
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {approved.map((a) => (
                <li key={a.address} className="flex flex-wrap items-center gap-3">
                  <PhaseBadge phase={phaseOf(a, now)} />
                  <span className="font-semibold">{eventLabel(a)} · {pair(a)}</span>
                  <Link to={`/events/${a.address}`} className="btn btn-secondary btn-sm ml-auto">Open</Link>
                </li>
              ))}
            </ul>
          </Window>
        </div>
      )}
    </Page>
  );
}

function Row({ a, slot, p }: { a: AuctionView; slot: number; p: Phase }) {
  const o = a.orders[slot];
  const sym = a.asset?.symbol ?? "";
  const r = p === "settled" ? personalResult(a, slot) : null;
  const escrow = o.side === SIDE_BUY ? `${fmtQuote(a, o.escrowed)} ${quoteSym(a)} locked` : `${fmtBase(a, o.escrowed)} ${sym} locked`;
  const result = r ? (o.side === SIDE_BUY ? `Paid ${fmtQuote(a, r.paid)}, returned ${fmtQuote(a, r.refundQuote)} ${quoteSym(a)}` : `Got ${fmtQuote(a, r.received)} ${quoteSym(a)}, returned ${fmtBase(a, r.refundBase)} ${sym}`) : escrow;
  return (
    <tr>
      <td className="font-semibold">{eventLabel(a)} · {pair(a)}</td>
      <td><PhaseBadge phase={p} /></td>
      <td><SideTag side={o.side} /></td>
      <td className="mono text-right">{fmtPrice(a, o.limitPrice)}</td>
      <td className="mono text-right">{fmtBase(a, o.qty)}</td>
      <td className="mono text-right">{r ? fmtBase(a, r.filled) : "—"}</td>
      <td>{result}</td>
      <td>{refundState(p)}</td>
      <td><Link to={`/events/${a.address}`} className="btn btn-secondary btn-sm">Open</Link></td>
    </tr>
  );
}
