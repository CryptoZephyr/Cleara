import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { connection } from "../lib/chain";
import { short } from "../lib/format";
import { DemoWalletName } from "../lib/demoWallet";
import { IconX } from "./icons";
import { Copyable } from "./ui";

export function useSolBalance() {
  const { publicKey } = useWallet();
  const [sol, setSol] = useState<number | null>(null);
  useEffect(() => {
    if (!publicKey) {
      setSol(null);
      return;
    }
    let live = true;
    const load = () => connection.getBalance(publicKey, "confirmed").then((b) => live && setSol(b / LAMPORTS_PER_SOL)).catch(() => undefined);
    load();
    const t = setInterval(load, 15000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [publicKey]);
  return sol;
}

export function WalletButton({ className = "" }: { className?: string }) {
  const { publicKey, wallet, disconnect, connecting } = useWallet();
  const [open, setOpen] = useState(false);
  const sol = useSolBalance();
  if (publicKey) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <span className="hidden text-right text-[12px] leading-[14px] lg:block">
          <span className="block mono">{short(publicKey.toBase58())}</span>
          <span className="block text-champagne/80">{wallet?.adapter.name === DemoWalletName ? "Demo wallet" : wallet?.adapter.name} · {sol === null ? "…" : sol.toFixed(3)} SOL</span>
        </span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }
  return (
    <>
      <button type="button" className={`btn btn-secondary btn-sm ${className}`} onClick={() => setOpen(true)} disabled={connecting}>
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
      {open && <WalletDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function WalletDialog({ onClose }: { onClose: () => void }) {
  const { wallets, select, connect, wallet } = useWallet();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    if (pending && wallet?.adapter.name === pending) {
      connect()
        .then(onClose)
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message || e.name : String(e));
          setPending(null);
        });
    }
  }, [pending, wallet, connect, onClose]);
  const usable = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  const demo = usable.filter((w) => w.adapter.name === DemoWalletName);
  const others = usable.filter((w) => w.adapter.name !== DemoWalletName);
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(440px,calc(100vw-32px))] rounded-[8px] border-2 border-emerald bg-cream p-0 text-ink shadow-[4px_4px_0_#10251E] backdrop:bg-ink/40" aria-labelledby="wallet-title">
      <div className="window-bar">
        <h2 id="wallet-title" className="m-0 flex-1 text-[13px]">Connect a Devnet wallet</h2>
        <button type="button" className="btn btn-ghost btn-sm min-h-[36px] text-champagne" onClick={onClose} aria-label="Close">
          <IconX />
        </button>
      </div>
      <div className="bg-devnet px-4 py-1 text-center label text-cream">Synthetic assets · Solana Devnet · No real asset value</div>
      <div className="flex flex-col gap-3 p-5">
        {[...demo, ...others].map((w) => (
          <button
            key={w.adapter.name}
            type="button"
            className="btn btn-secondary justify-start normal-case tracking-normal"
            disabled={pending !== null}
            onClick={() => {
              setError(null);
              setPending(w.adapter.name);
              select(w.adapter.name);
            }}
          >
            <img src={w.adapter.icon} alt="" width={22} height={22} />
            <span className="flex-1 text-left text-[14px]">{w.adapter.name}</span>
            {pending === w.adapter.name && <span className="text-[12px]">Connecting…</span>}
          </button>
        ))}
        <p className="m-0 text-[13px] leading-[18px] text-muted">
          The demo wallet is a Devnet key stored in this browser so you can try Cleara without installing anything. Never send real funds to it.
          {others.length === 0 && " No browser wallet was detected; Phantom or Solflare set to Devnet also work."}
        </p>
        {error && <p role="alert" className="m-0 text-[13px] text-danger">Wallet connection failed: {error}</p>}
      </div>
    </dialog>
  );
}

export function WalletAddress() {
  const { publicKey } = useWallet();
  return publicKey ? <Copyable value={publicKey.toBase58()} /> : null;
}
