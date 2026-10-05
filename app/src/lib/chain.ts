import { BN, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  type AccountMeta,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import idlJson from "../idl/cleara.json";
import type { Cleara } from "../idl/cleara";
import { CONFIG, ISSUERS, assetByMint, type AssetConfig } from "../../shared/config";
import { PROGRAM_ID, SIDE_EMPTY, STATUS_SETTLED, vaultPdas, type BookOrder } from "../../shared/cleara";

export const RPC_URL = (import.meta.env.VITE_RPC_URL as string | undefined) || CONFIG.rpc;
export const connection = new Connection(RPC_URL, "confirmed");
const program = new Program<Cleara>(idlJson as Cleara, { connection });

export interface RosterView {
  participant: string;
  allowance: number;
  active: number;
}

export interface AuctionView {
  address: string;
  issuer: string;
  id: bigint;
  asset: AssetConfig | undefined;
  baseMint: string;
  quoteMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  feeAccount: string;
  deadline: number;
  settleBy: number;
  minBaseQty: bigint;
  feeBps: number;
  status: number;
  clearingPrice: bigint;
  clearedVolume: bigint;
  orders: BookOrder[];
  roster: RosterView[];
}

interface RawOrder {
  owner: PublicKey;
  side: number;
  limitPrice: BN;
  qty: BN;
  escrowed: BN;
  filled: BN;
}
interface RawAuction {
  issuer: PublicKey;
  auctionId: BN;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseDecimals: number;
  quoteDecimals: number;
  feeAccount: PublicKey;
  deadline: BN;
  settleBy: BN;
  minBaseQty: BN;
  feeBps: number;
  status: number;
  clearingPrice: BN;
  clearedVolume: BN;
  orders: RawOrder[];
  roster: { participant: PublicKey; allowance: number; active: number }[];
  rosterLen: number;
}

const big = (b: BN) => BigInt(b.toString());

function toView(address: string, a: RawAuction): AuctionView {
  return {
    address,
    issuer: a.issuer.toBase58(),
    id: big(a.auctionId),
    asset: assetByMint(a.baseMint.toBase58()),
    baseMint: a.baseMint.toBase58(),
    quoteMint: a.quoteMint.toBase58(),
    baseDecimals: a.baseDecimals,
    quoteDecimals: a.quoteDecimals,
    feeAccount: a.feeAccount.toBase58(),
    deadline: a.deadline.toNumber(),
    settleBy: a.settleBy.toNumber(),
    minBaseQty: big(a.minBaseQty),
    feeBps: a.feeBps,
    status: a.status,
    clearingPrice: big(a.clearingPrice),
    clearedVolume: big(a.clearedVolume),
    orders: a.orders.map((o, slot) => ({
      slot,
      owner: o.owner.toBase58(),
      side: o.side,
      limitPrice: big(o.limitPrice),
      qty: big(o.qty),
      escrowed: big(o.escrowed),
      filled: big(o.filled),
    })),
    roster: a.roster.slice(0, a.rosterLen).map((r) => ({
      participant: r.participant.toBase58(),
      allowance: r.allowance,
      active: r.active,
    })),
  };
}

export const decodeAuction = (address: string, data: Buffer) => toView(address, program.coder.accounts.decode("auction", data) as RawAuction);

const issuerFilters = ISSUERS.map((issuer) => [{ memcmp: { offset: 8, bytes: issuer } }]);

/** Events priced in a retired quote mint (the old synthetic dUSDC); kept for My orders and refunds. */
export const isLegacy = (a: AuctionView) => a.quoteMint !== CONFIG.quoteMint;
export const isTeamIssued = (a: AuctionView) => !!CONFIG.squads && a.issuer === CONFIG.squads.vault;
export const quoteSym = (a: AuctionView) => (isLegacy(a) ? "dUSDC" : CONFIG.quoteSymbol);

export async function fetchAuctions(): Promise<AuctionView[]> {
  const accounts = (await Promise.all(issuerFilters.map((filters) => connection.getProgramAccounts(PROGRAM_ID, { commitment: "confirmed", filters })))).flat();
  return accounts
    .map(({ pubkey, account }) => decodeAuction(pubkey.toBase58(), account.data))
    .sort((x, y) => Number(y.id - x.id));
}

export async function fetchAuction(address: string): Promise<AuctionView | null> {
  const info = await connection.getAccountInfo(new PublicKey(address), "confirmed");
  if (!info || !info.owner.equals(PROGRAM_ID)) return null;
  return decodeAuction(address, info.data);
}

/** Streams every change to Cleara issuers' auction accounts over the RPC websocket. Returns an unsubscribe function. */
export function watchAuctions(onChange: (a: AuctionView) => void): () => void {
  const ids = issuerFilters.map((filters) => connection.onProgramAccountChange(
    PROGRAM_ID,
    ({ accountId, accountInfo }) => {
      try {
        const a = decodeAuction(accountId.toBase58(), accountInfo.data);
        onChange(a);
      } catch {
        return;
      }
    },
    { commitment: "confirmed", filters }
  ));
  return () => ids.forEach((id) => void connection.removeProgramAccountChangeListener(id).catch(() => undefined));
}

export function watchAuction(address: string, onChange: (a: AuctionView) => void): () => void {
  const id = connection.onAccountChange(
    new PublicKey(address),
    (info) => {
      if (info.owner.equals(PROGRAM_ID)) onChange(decodeAuction(address, info.data));
    },
    { commitment: "confirmed" }
  );
  return () => void connection.removeAccountChangeListener(id).catch(() => undefined);
}

export type Phase = "open" | "closing" | "awaiting" | "settled" | "expired";

export function phaseOf(a: AuctionView, now: number): Phase {
  if (a.status === STATUS_SETTLED) return "settled";
  if (now < a.deadline) return a.deadline - now < 6 * 3600 ? "closing" : "open";
  if (now <= a.settleBy) return "awaiting";
  return "expired";
}

export const activeOrders = (a: AuctionView) => a.orders.filter((o) => o.side !== SIDE_EMPTY);

/** Every Cleara synthetic base asset is a Token-2022 mint; quote is a classic SPL token. */
const BASE_TOKEN_PROGRAM = TOKEN_2022_PROGRAM_ID;

function ownerAccounts(a: AuctionView, owner: PublicKey) {
  return {
    ownerBase: getAssociatedTokenAddressSync(new PublicKey(a.baseMint), owner, true, BASE_TOKEN_PROGRAM),
    ownerQuote: getAssociatedTokenAddressSync(new PublicKey(a.quoteMint), owner, true, TOKEN_PROGRAM_ID),
  };
}

function common(a: AuctionView) {
  const auction = new PublicKey(a.address);
  const { baseVault, quoteVault } = vaultPdas(auction);
  return {
    auction,
    baseMint: new PublicKey(a.baseMint),
    quoteMint: new PublicKey(a.quoteMint),
    baseVault,
    quoteVault,
    baseTokenProgram: BASE_TOKEN_PROGRAM,
    quoteTokenProgram: TOKEN_PROGRAM_ID,
  };
}

export async function placeOrderIxs(a: AuctionView, owner: PublicKey, side: number, price: bigint, qty: bigint) {
  const c = common(a);
  const acc = ownerAccounts(a, owner);
  return [
    createAssociatedTokenAccountIdempotentInstruction(owner, acc.ownerBase, owner, c.baseMint, c.baseTokenProgram),
    createAssociatedTokenAccountIdempotentInstruction(owner, acc.ownerQuote, owner, c.quoteMint, TOKEN_PROGRAM_ID),
    await program.methods
      .placeOrder(side, new BN(price.toString()), new BN(qty.toString()))
      .accountsPartial({ owner, ...c, ...acc })
      .instruction(),
  ];
}

export async function cancelOrderIxs(a: AuctionView, owner: PublicKey, slot: number) {
  return [
    await program.methods
      .cancelOrder(slot)
      .accountsPartial({ owner, ...common(a), ...ownerAccounts(a, owner) })
      .instruction(),
  ];
}

export async function settleIxs(a: AuctionView) {
  const rem: AccountMeta[] = [];
  for (const o of activeOrders(a)) {
    const acc = ownerAccounts(a, new PublicKey(o.owner));
    rem.push({ pubkey: acc.ownerBase, isSigner: false, isWritable: true });
    rem.push({ pubkey: acc.ownerQuote, isSigner: false, isWritable: true });
  }
  const c = common(a);
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
    await program.methods
      .settle()
      .accountsPartial({
        auction: c.auction,
        baseMint: c.baseMint,
        quoteMint: c.quoteMint,
        baseVault: c.baseVault,
        quoteVault: c.quoteVault,
        feeAccount: new PublicKey(a.feeAccount),
        baseTokenProgram: c.baseTokenProgram,
        quoteTokenProgram: c.quoteTokenProgram,
      })
      .remainingAccounts(rem)
      .instruction(),
  ];
}

export async function refundIxs(a: AuctionView, slot: number) {
  const o = a.orders[slot];
  return [
    await program.methods
      .refundExpired(slot)
      .accountsPartial({ ...common(a), ...ownerAccounts(a, new PublicKey(o.owner)) })
      .instruction(),
  ];
}

export async function sendIxs(wallet: WalletContextState, ixs: TransactionInstruction[]) {
  if (!wallet.publicKey) throw new Error("Connect a wallet first.");
  const tx = new Transaction().add(...ixs);
  tx.feePayer = wallet.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  const signature = await wallet.sendTransaction(tx, connection, { maxRetries: 5 });
  const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`Transaction failed onchain: ${JSON.stringify(res.value.err)}`);
  return signature;
}

export async function tokenBalance(mint: string, owner: PublicKey, program2022: boolean): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(new PublicKey(mint), owner, true, program2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID);
  try {
    const b = await connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(b.value.amount);
  } catch {
    return 0n;
  }
}

/** Most recent successful transaction that touched the auction account (the settlement, once settled). */
export async function latestSignature(address: string): Promise<string | null> {
  const sigs = await connection.getSignaturesForAddress(new PublicKey(address), { limit: 10 }, "confirmed");
  return sigs.find((s) => !s.err)?.signature ?? null;
}

export async function chainTimeOffset(): Promise<number> {
  const t = await connection.getBlockTime(await connection.getSlot("confirmed"));
  return t ? t - Date.now() / 1000 : 0;
}

const ERROR_TEXT: Record<string, string> = {
  PastDeadline: "The order deadline has passed, so orders can no longer be placed or cancelled.",
  BeforeDeadline: "Settlement opens only after the order deadline.",
  SettlementExpired: "The settlement window has passed. Each order can now be refunded instead.",
  NotExpired: "Refunds open only after the settlement window ends.",
  OrderTooSmall: "This order is below the event's minimum order size.",
  NotOnRoster: "This wallet is not on the event's approved participant list.",
  AllowanceUsed: "This wallet has used all of its order slots in this event.",
  SelfTrade: "This wallet already has an order on the other side. Self-trading is not allowed.",
  BookFull: "All 8 order slots in this event are taken.",
  NotOrderOwner: "Only the wallet that placed this order can cancel it.",
  NotOpen: "This event is no longer open.",
  BadPrice: "The limit price must be greater than zero.",
  WrongAccounts: "Settlement accounts did not match the order book. Refresh and try again.",
  VaultMismatch: "Escrow balances did not match the order book, so nothing was moved.",
};

export function explainError(e: unknown): string {
  const s = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (/User rejected|rejected the request|WalletSignTransactionError/i.test(s))
    return "You declined the request in your wallet. Nothing was sent.";
  for (const [code, text] of Object.entries(ERROR_TEXT)) if (s.includes(code)) return text;
  const m = s.match(/custom program error: 0x([0-9a-f]+)/i);
  if (m) {
    const code = parseInt(m[1], 16);
    const err = (idlJson as { errors: { code: number; name: string }[] }).errors.find((x) => x.code === code);
    if (err && ERROR_TEXT[err.name]) return ERROR_TEXT[err.name];
    if (code === 0x11 || code === 1) return "The asset's transfer rules rejected this action, or the balance is too low. Review your balance and eligibility, or contact the event issuer.";
  }
  if (/insufficient (funds|lamports)|Attempt to debit an account but found no record/i.test(s))
    return "This wallet does not have enough devnet SOL or tokens for this action. Use “Get demo funds” and try again.";
  if (/frozen/i.test(s)) return "The asset's transfer rules rejected this action. Review your eligibility or contact the event issuer.";
  if (/429|Too many requests/i.test(s)) return "The public Devnet RPC is rate-limiting requests. Wait a few seconds and retry.";
  return s.length > 220 ? s.slice(0, 220) + "…" : s;
}

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
