import {
  BaseSignerWalletAdapter,
  WalletNotConnectedError,
  WalletReadyState,
  isVersionedTransaction,
  type TransactionOrVersionedTransaction,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { Keypair, type PublicKey } from "@solana/web3.js";

const STORAGE_KEY = "cleara.demoWallet.v1";
export const DemoWalletName = "Cleara demo wallet (Devnet)" as WalletName<"Cleara demo wallet (Devnet)">;

const ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#7665A8"/><path d="M5 22h4v-4h4v-4h3v8" fill="none" stroke="#FFF8E8" stroke-width="2.5"/><path d="M27 22h-4v-4h-4v-4h-3" fill="none" stroke="#FFF8E8" stroke-width="2.5"/></svg>'
  );

function loadOrCreate(): Keypair {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  const kp = Keypair.generate();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

/** A browser-stored Devnet keypair so judges can try Cleara without installing a wallet. Never use for real funds. */
export class DemoWalletAdapter extends BaseSignerWalletAdapter<"Cleara demo wallet (Devnet)"> {
  name = DemoWalletName;
  url = "https://solana.com/docs/core/accounts";
  icon = ICON;
  readyState = typeof window === "undefined" ? WalletReadyState.Unsupported : WalletReadyState.Loadable;
  supportedTransactionVersions = new Set(["legacy", 0] as const);
  connecting = false;
  private keypair: Keypair | null = null;

  get publicKey(): PublicKey | null {
    return this.keypair?.publicKey ?? null;
  }

  async connect(): Promise<void> {
    this.connecting = true;
    this.keypair = loadOrCreate();
    this.connecting = false;
    this.emit("connect", this.keypair.publicKey);
  }

  async disconnect(): Promise<void> {
    this.keypair = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>>(tx: T): Promise<T> {
    if (!this.keypair) throw new WalletNotConnectedError();
    if (isVersionedTransaction(tx)) tx.sign([this.keypair]);
    else tx.partialSign(this.keypair);
    return tx;
  }
}
