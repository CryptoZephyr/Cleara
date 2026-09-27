import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { CONFIG } from "../../shared/config";
import { SIDE_BUY, SIDE_EMPTY, SIDE_SELL, formatAtoms, parseAtoms, quoteCeil } from "../../shared/cleara";
import { cancelOrderIxs, explainError, explorerTx, placeOrderIxs, quoteSym, sendIxs, tokenBalance, type AuctionView } from "../lib/chain";
import { requestFunds } from "../lib/api";
import { isValid, useAttestations } from "../lib/attest";
import { dateTime, fmtBase, fmtPrice, fmtQuote, pair } from "../lib/format";
import { useSolBalance, WalletDialog } from "./Wallet";
import { IconExternal, IconX } from "./icons";
import { Notice, SideTag } from "./ui";
import { PayQr } from "./PayQr";

function Overlay({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab" && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>("button:not(:disabled), input, a[href]"));
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/35" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`drawer-enter flex h-full w-full flex-col border-l-2 border-emerald bg-cream sm:shadow-[-4px_0_0_#10251E] ${wide ? "sm:max-w-[480px]" : "sm:max-w-[400px]"}`}
      >
        <div className="window-bar">
          <h2 className="m-0 flex-1 text-[13px]">{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm min-h-[36px] text-champagne" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="h-7 shrink-0 bg-devnet px-4 text-center label leading-7 text-cream">Synthetic assets · Solana Devnet · No real asset value</div>
        <div className="flex-1 overflow-y-auto p-5 max-sm:p-4">{children}</div>
      </div>
    </div>
  );
}

type Step = { kind: "form" } | { kind: "review" } | { kind: "signing" } | { kind: "done"; sig: string } | { kind: "error"; msg: string };

export function OrderDrawer({ a, initialSide, onClose, onDone }: { a: AuctionView; initialSide: number; onClose: () => void; onDone: () => void }) {
  const wallet = useWallet();
  const me = wallet.publicKey?.toBase58() ?? null;
  const sol = useSolBalance();
  const [side, setSide] = useState(initialSide);
  const [price, setPrice] = useState(() => (initialSide === SIDE_BUY ? "0.97" : "0.93"));
  const [qty, setQty] = useState("2");
  const [phone, setPhone] = useState(false);
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [bal, setBal] = useState<{ base: bigint; quote: bigint } | null>(null);
  const [funding, setFunding] = useState<string | null>(null);
  const [showWallet, setShowWallet] = useState(false);
  const sym = a.asset?.symbol ?? "";

  const loadBal = async () => {
    if (!wallet.publicKey) return;
    const [base, quote] = await Promise.all([tokenBalance(a.baseMint, wallet.publicKey, true), tokenBalance(a.quoteMint, wallet.publicKey, false)]);
    setBal({ base, quote });
  };
  useEffect(() => {
    loadBal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.publicKey, a.address]);

  const p = parseAtoms(price, a.quoteDecimals);
  const q = parseAtoms(qty, a.baseDecimals);
  const locked = p && q ? (side === SIDE_BUY ? quoteCeil(q, p, a.baseDecimals) : q) : null;
  const roster = me ? a.roster.find((r) => r.participant === me) : undefined;
  const remaining = roster ? roster.allowance - roster.active : 0;
  const atts = useAttestations(me ? [me] : []);
  const credential = me && atts ? atts.get(me) : undefined;
  const mine = a.orders.filter((o) => o.side !== SIDE_EMPTY && o.owner === me);
  const oppositeSide = mine.some((o) => o.side !== side);
  const freeSlots = a.orders.filter((o) => o.side === SIDE_EMPTY).length;

  const problems: string[] = [];
  if (!p || p === 0n) problems.push("Enter a limit price greater than zero.");
  if (!q || q === 0n) problems.push("Enter a quantity.");
  if (q !== null && q > 0n && q < a.minBaseQty) problems.push(`Minimum order is ${fmtBase(a, a.minBaseQty)} ${sym}.`);
  if (me && !roster) problems.push("This wallet is not on this event's approved participant list.");
  if (roster && remaining <= 0) problems.push("This wallet has used all of its order slots in this event.");
  if (oppositeSide) problems.push("This wallet already has an order on the other side. Self-trading is not allowed.");
  if (freeSlots === 0) problems.push("All 8 order slots are taken.");
  const shortBalance = bal && locked !== null && (side === SIDE_BUY ? bal.quote < locked : bal.base < locked);
  if (shortBalance) problems.push(side === SIDE_BUY ? `Not enough ${quoteSym(a)} to lock.` : `Not enough ${sym} to lock.`);
  const lowSol = sol !== null && sol < 0.003;

  async function fund() {
    if (!me) return;
    setFunding("Requesting demo tokens and devnet SOL…");
    try {
      const r = await requestFunds(me, a.baseMint, locked === null ? {} : side === SIDE_BUY ? { quote: locked } : { base: locked });
      setFunding(r.message);
      await loadBal();
    } catch (e) {
      setFunding(`Funding failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function submit() {
    if (!wallet.publicKey || !p || !q) return;
    setStep({ kind: "signing" });
    try {
      const sig = await sendIxs(wallet, await placeOrderIxs(a, wallet.publicKey, side, p, q));
      setStep({ kind: "done", sig });
      onDone();
    } catch (e) {
      setStep({ kind: "error", msg: explainError(e) });
    }
  }

  const title = `${side === SIDE_BUY ? "Buy" : "Sell"} ${pair(a)}`;
  if (!wallet.publicKey)
    return (
      <Overlay title={title} onClose={onClose}>
        <p className="mt-0">Connect a Devnet wallet to place a funded order. Your order and its limit will be public onchain.</p>
        <button type="button" className="btn btn-primary w-full" onClick={() => setShowWallet(true)}>Connect wallet</button>
        {showWallet && <WalletDialog onClose={() => setShowWallet(false)} />}
      </Overlay>
    );

  if (step.kind === "done")
    return (
      <Overlay title="Order placed" onClose={onClose}>
        <div aria-live="polite" className="flex flex-col gap-4">
          <Notice tone="ok" title="Your order is funded and in the public book">
            {locked !== null && (side === SIDE_BUY ? `${fmtQuote(a, locked)} ${quoteSym(a)}` : `${fmtBase(a, locked)} ${sym}`)} is locked in the event escrow. You can cancel it until {dateTime(a.deadline)}.
          </Notice>
          <a className="btn btn-secondary" href={explorerTx(step.sig)} target="_blank" rel="noreferrer">View transaction <IconExternal /></a>
          <button type="button" className="btn btn-primary" onClick={onClose}>Return to event</button>
        </div>
      </Overlay>
    );

  return (
    <Overlay title={title} onClose={onClose}>
      {step.kind === "form" && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (problems.length === 0) setStep({ kind: "review" });
          }}
        >
          <div role="tablist" aria-label="Order side" className="grid grid-cols-2 gap-2">
            {[SIDE_BUY, SIDE_SELL].map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={side === s}
                className={`btn ${side === s ? (s === SIDE_BUY ? "btn-buy" : "btn-sell") : "btn-secondary opacity-70"}`}
                onClick={() => setSide(s)}
              >
                {s === SIDE_BUY ? "↑ Buy" : "↓ Sell"}
              </button>
            ))}
          </div>
          <label>
            <span className="label text-muted">Limit price ({quoteSym(a)} per {sym})</span>
            <input className="field mt-1" inputMode="decimal" value={price} aria-invalid={!p} onChange={(e) => setPrice(e.target.value)} />
            <span className="mt-1 block text-[12px] text-muted">{side === SIDE_BUY ? "The most you will pay per token." : "The least you will accept per token."} Everyone who trades pays or receives the same clearing price.</span>
          </label>
          <label>
            <span className="label text-muted">Quantity ({sym})</span>
            <input className="field mt-1" inputMode="decimal" value={qty} aria-invalid={!q} onChange={(e) => setQty(e.target.value)} />
          </label>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 rounded-[4px] border border-line bg-champagne/50 p-3 text-[13px]">
            <dt className="text-muted">Amount locked</dt>
            <dd className="m-0 mono text-right">{locked === null ? "—" : side === SIDE_BUY ? `${fmtQuote(a, locked)} ${quoteSym(a)}` : `${fmtBase(a, locked)} ${sym}`}</dd>
            <dt className="text-muted">Your balance</dt>
            <dd className="m-0 mono text-right">{bal ? (side === SIDE_BUY ? `${fmtQuote(a, bal.quote)} ${quoteSym(a)}` : `${fmtBase(a, bal.base)} ${sym}`) : "…"}</dd>
            <dt className="text-muted">Order allowance left</dt>
            <dd className="m-0 mono text-right">{roster ? `${remaining} of ${roster.allowance}` : "Not approved"}</dd>
            <dt className="text-muted">Fee</dt>
            <dd className="m-0 text-right">{side === SIDE_SELL ? `${(a.feeBps / 100).toFixed(2)}% of proceeds` : "None for buyers"}</dd>
            <dt className="text-muted">Transfer rules</dt>
            <dd className="m-0 text-right">Token-2022, metadata only; no transfer hook or fee</dd>
          </dl>
          {problems.length > 0 && (
            <Notice tone="warn" title="Before you can review">
              <ul className="m-0 pl-4">{problems.map((x) => <li key={x}>{x}</li>)}</ul>
              {me && !roster && <p className="mb-0 mt-2">Start your own demo event from the Events page to join one as an approved participant.</p>}
            </Notice>
          )}
          {roster && CONFIG.sas && credential !== undefined && (
            <p className="m-0 text-[13px] text-muted">
              Participant credential: {isValid(credential, Date.now() / 1000) ? "valid Cleara credential on the Solana Attestation Service (Devnet)" : "none found on the Solana Attestation Service; the event's approved list still applies"}.
            </p>
          )}
          {shortBalance && side === SIDE_BUY && (
            <p className="m-0 text-[13px] text-muted">
              Buy orders lock {CONFIG.quoteName}. Get it free at{" "}
              <a className="text-ink underline underline-offset-2" href={CONFIG.quoteFaucet} target="_blank" rel="noreferrer">faucet.circle.com</a>: choose Solana Devnet and paste your wallet address.
            </p>
          )}
          {(shortBalance || lowSol) && roster && (
            <div className="flex flex-col gap-2">
              <button type="button" className="btn btn-secondary" onClick={fund} disabled={funding === "Requesting demo tokens and devnet SOL…"}>Get demo funds</button>
              {funding && <p className="m-0 text-[13px] text-muted" aria-live="polite">{funding}</p>}
            </div>
          )}
          <button type="submit" className="btn btn-primary" disabled={problems.length > 0}>Review order</button>
        </form>
      )}
      {(step.kind === "review" || step.kind === "signing" || step.kind === "error") && p && q && locked !== null && (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-[15px]">Check the details. Your wallet will ask you to sign after this.</p>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
            <dt className="text-muted">Asset</dt><dd className="m-0">{a.asset?.name} ({sym})</dd>
            <dt className="text-muted">Side</dt><dd className="m-0"><SideTag side={side} /></dd>
            <dt className="text-muted">Limit price</dt><dd className="m-0 mono">{fmtPrice(a, p)} {quoteSym(a)}</dd>
            <dt className="text-muted">Quantity</dt><dd className="m-0 mono">{fmtBase(a, q)} {sym}</dd>
            <dt className="text-muted">Locked now</dt><dd className="m-0 mono">{side === SIDE_BUY ? `${fmtQuote(a, locked)} ${quoteSym(a)}` : `${fmtBase(a, locked)} ${sym}`}</dd>
            <dt className="text-muted">Deadline</dt><dd className="m-0">{dateTime(a.deadline)} (also the cancellation cutoff)</dd>
            <dt className="text-muted">Network</dt><dd className="m-0">Solana Devnet</dd>
            <dt className="text-muted">Visibility</dt><dd className="m-0">Public: your limit and quantity can be read onchain by anyone.</dd>
            <dt className="text-muted">If unmatched</dt><dd className="m-0">Returned at settlement, or refundable after {dateTime(a.settleBy)}, subject to the token's transfer rules.</dd>
          </dl>
          {step.kind === "error" && <Notice tone="danger" title="Order not placed">{step.msg}</Notice>}
          {phone ? (
            <PayQr a={a} side={side} price={price} qty={qty} owner={me} onClose={() => setPhone(false)} />
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => setPhone(true)} disabled={step.kind === "signing"}>Sign on your phone (Solana Pay)</button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setStep({ kind: "form" })} disabled={step.kind === "signing"}>Edit</button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={step.kind === "signing"}>
              {step.kind === "signing" ? "Waiting for wallet…" : step.kind === "error" ? "Retry" : `Sign and lock ${formatAtoms(locked, side === SIDE_BUY ? a.quoteDecimals : a.baseDecimals, 2)}`}
            </button>
          </div>
        </div>
      )}
    </Overlay>
  );
}

export function CancelDialog({ a, slot, onClose, onDone }: { a: AuctionView; slot: number; onClose: () => void; onDone: () => void }) {
  const wallet = useWallet();
  const o = a.orders[slot];
  const sym = a.asset?.symbol ?? "";
  const [st, setSt] = useState<{ kind: "idle" | "signing" } | { kind: "done"; sig: string } | { kind: "error"; msg: string }>({ kind: "idle" });
  const [back] = useState(() => (o.side === SIDE_BUY ? `${fmtQuote(a, o.escrowed)} ${quoteSym(a)}` : `${fmtBase(a, o.escrowed)} ${sym}`));
  return (
    <Overlay title={`Cancel order #${slot + 1}`} onClose={onClose}>
      <div className="flex flex-col gap-4" aria-live="polite">
        {st.kind === "done" ? (
          <>
            <Notice tone="ok" title="Order cancelled">{back} was returned to your wallet in the same transaction.</Notice>
            <a className="btn btn-secondary" href={explorerTx(st.sig)} target="_blank" rel="noreferrer">View transaction <IconExternal /></a>
            <button type="button" className="btn btn-primary" onClick={onClose}>Return to event</button>
          </>
        ) : (
          <>
            <p className="m-0">Cancelling removes your <SideTag side={o.side} /> order at {fmtPrice(a, o.limitPrice)} {quoteSym(a)} and returns {back} to your wallet immediately. Your allowance slot becomes free again.</p>
            {st.kind === "error" && <Notice tone="danger" title="Cancellation failed">{st.msg}</Notice>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Keep order</button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={st.kind === "signing"}
                onClick={async () => {
                  if (!wallet.publicKey) return;
                  setSt({ kind: "signing" });
                  try {
                    const sig = await sendIxs(wallet, await cancelOrderIxs(a, wallet.publicKey, slot));
                    setSt({ kind: "done", sig });
                    onDone();
                  } catch (e) {
                    setSt({ kind: "error", msg: explainError(e) });
                  }
                }}
              >
                {st.kind === "signing" ? "Waiting for wallet…" : "Cancel order"}
              </button>
            </div>
          </>
        )}
      </div>
    </Overlay>
  );
}
