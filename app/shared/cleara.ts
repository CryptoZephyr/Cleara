import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("AnVHa4HHZHhUTepWnSGwxDLUEmkKyAuD6sHeKPtTSY6W");
export const MAX_ORDERS = 8;
export const SIDE_EMPTY = 0;
export const SIDE_BUY = 1;
export const SIDE_SELL = 2;
export const STATUS_OPEN = 0;
export const STATUS_SETTLED = 1;

const enc = new TextEncoder();

export function u64le(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
}

export function auctionPda(issuer: PublicKey, id: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc.encode("auction"), issuer.toBytes(), u64le(id)],
    PROGRAM_ID
  )[0];
}

export function vaultPdas(auction: PublicKey) {
  const [baseVault] = PublicKey.findProgramAddressSync(
    [enc.encode("base_vault"), auction.toBytes()],
    PROGRAM_ID
  );
  const [quoteVault] = PublicKey.findProgramAddressSync(
    [enc.encode("quote_vault"), auction.toBytes()],
    PROGRAM_ID
  );
  return { baseVault, quoteVault };
}

export interface BookOrder {
  slot: number;
  owner: string;
  side: number;
  limitPrice: bigint;
  qty: bigint;
  escrowed: bigint;
  filled: bigint;
}

export interface Clearing {
  price: bigint;
  volume: bigint;
  fills: bigint[];
}

const scale = (decimals: number) => 10n ** BigInt(decimals);

export const quoteCeil = (qty: bigint, price: bigint, baseDecimals: number) => {
  const n = qty * price;
  const s = scale(baseDecimals);
  return (n + s - 1n) / s;
};

export const quoteFloor = (qty: bigint, price: bigint, baseDecimals: number) =>
  (qty * price) / scale(baseDecimals);

function eligible(o: BookOrder, price: bigint) {
  if (o.side === SIDE_BUY) return o.limitPrice >= price;
  if (o.side === SIDE_SELL) return o.limitPrice <= price;
  return false;
}

/** Mirror of programs/cleara/src/clearing.rs. `orders` is the full 8-slot book. */
export function clear(orders: BookOrder[]): Clearing {
  let price = 0n;
  let volume = 0n;
  for (const cand of orders.filter((o) => o.side !== SIDE_EMPTY)) {
    const p = cand.limitPrice;
    let demand = 0n;
    let supply = 0n;
    for (const o of orders) {
      if (!eligible(o, p)) continue;
      if (o.side === SIDE_BUY) demand += o.qty;
      else supply += o.qty;
    }
    const v = demand < supply ? demand : supply;
    if (v > volume || (v === volume && v > 0n && p < price)) {
      price = p;
      volume = v;
    }
  }
  const fills = orders.map(() => 0n);
  if (volume === 0n) return { price: 0n, volume: 0n, fills };
  allocate(orders, SIDE_BUY, price, volume, fills);
  allocate(orders, SIDE_SELL, price, volume, fills);
  return { price, volume, fills };
}

function allocate(orders: BookOrder[], side: number, price: bigint, volume: bigint, fills: bigint[]) {
  const idx = orders
    .map((_, i) => i)
    .filter((i) => orders[i].side === side && eligible(orders[i], price))
    .sort((a, b) => {
      const pa = orders[a].limitPrice;
      const pb = orders[b].limitPrice;
      const byPrice = side === SIDE_BUY ? (pb > pa ? 1 : pb < pa ? -1 : 0) : pa > pb ? 1 : pa < pb ? -1 : 0;
      return byPrice || a - b;
    });
  let remaining = volume;
  let i = 0;
  while (i < idx.length && remaining > 0n) {
    const level = orders[idx[i]].limitPrice;
    let j = i;
    while (j < idx.length && orders[idx[j]].limitPrice === level) j++;
    const lvl = idx.slice(i, j);
    const levelQty = lvl.reduce((s, k) => s + orders[k].qty, 0n);
    if (levelQty <= remaining) {
      for (const k of lvl) fills[k] = orders[k].qty;
      remaining -= levelQty;
    } else {
      let given = 0n;
      for (const k of lvl) {
        fills[k] = (orders[k].qty * remaining) / levelQty;
        given += fills[k];
      }
      let left = remaining - given;
      for (const k of [...lvl].sort((a, b) => a - b)) {
        if (left === 0n) break;
        if (fills[k] < orders[k].qty) {
          fills[k] += 1n;
          left -= 1n;
        }
      }
      remaining = 0n;
    }
    i = j;
  }
}

/** Exact decimal string for an integer atom amount. */
export function formatAtoms(atoms: bigint, decimals: number, maxFrac = decimals): string {
  const neg = atoms < 0n;
  const a = neg ? -atoms : atoms;
  const s = scale(decimals);
  const whole = a / s;
  const frac = (a % s).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${w}${frac ? "." + frac : ""}`;
}

/** Parses a user-entered decimal string into atoms. Returns null when invalid or too precise. */
export function parseAtoms(input: string, decimals: number): bigint | null {
  const t = input.trim();
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) return null;
  return BigInt(w || "0") * scale(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}
