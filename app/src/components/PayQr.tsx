import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { SIDE_EMPTY } from "../../shared/cleara";
import type { AuctionView } from "../lib/chain";
import { Notice } from "./ui";

/** Solana Pay transaction-request QR for the order in the drawer; the phone wallet fetches, signs and sends it. */
export function PayQr({ a, side, price, qty, owner, onClose }: { a: AuctionView; side: number; price: string; qty: string; owner: string | null; onClose: () => void }) {
  const [svg, setSvg] = useState<string | null>(null);
  const link = `${window.location.origin}/api/pay?${new URLSearchParams({ auction: a.address, side: String(side), price, qty })}`;
  const uri = `solana:${encodeURIComponent(link)}`;
  const count = (x: AuctionView) => x.orders.filter((o) => o.side !== SIDE_EMPTY && (!owner || o.owner === owner)).length;
  const start = useRef(count(a));
  const arrived = count(a) > start.current;

  useEffect(() => {
    QRCode.toString(uri, { type: "svg", margin: 1, width: 220, color: { dark: "#10251E", light: "#FFF8E8" } })
      .then(setSvg)
      .catch(() => setSvg(null));
  }, [uri]);

  return (
    <div className="flex flex-col gap-3 rounded-[4px] border border-line bg-champagne/50 p-3">
      <p className="m-0 text-[13px]">
        Scan with a Solana Pay wallet (such as Phantom or Solflare) set to <strong>Devnet</strong>, using {owner ? "this same approved wallet" : "an approved wallet"}. The wallet shows the order, and you sign it there.
      </p>
      {svg ? <div className="mx-auto h-[220px] w-[220px]" role="img" aria-label="Solana Pay QR code for this order" dangerouslySetInnerHTML={{ __html: svg }} /> : <p className="m-0 text-[13px] text-muted">Drawing QR…</p>}
      <a className="mono break-all text-[11px] text-muted" href={uri}>Open in a wallet on this device</a>
      {arrived ? (
        <Notice tone="ok" title="Order received onchain">The order from your phone is now in the public book.</Notice>
      ) : (
        <p className="m-0 text-[12px] text-muted" aria-live="polite">Waiting for the signed order to appear onchain…</p>
      )}
      <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Hide QR</button>
    </div>
  );
}
