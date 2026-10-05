import { PublicKey } from "@solana/web3.js";

export const TUKTUK_PROGRAM_ID = new PublicKey("tuktukUrfhXT6ZT77QTU8RQtvgL967uRuVagWF57zVA");
/** Reusable Devnet task queue owned by the demo operator (created by scripts/setup-tuktuk.ts). */
export const TASK_QUEUE = new PublicKey("AtubFP4tMJMR1Bq7pn3HG5YHf7E2xj73n9pLjFvRLw2E");
export const TASK_QUEUE_NAME = "cleara-settle";
export const DEFAULT_CRANK_URL = "https://cleara-ten.vercel.app/api/crank";

const enc = new TextEncoder();

export function taskPda(taskQueue: PublicKey, id: number) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, id, true);
  return PublicKey.findProgramAddressSync([enc.encode("task"), taskQueue.toBytes(), b], TUKTUK_PROGRAM_ID)[0];
}

export function taskQueueAuthorityPda(taskQueue: PublicKey, authority: PublicKey) {
  return PublicKey.findProgramAddressSync([enc.encode("task_queue_authority"), taskQueue.toBytes(), authority.toBytes()], TUKTUK_PROGRAM_ID)[0];
}

/** Settle tasks point TukTuk at `<crank url>?auction=<event>&lut=<lookup table>`. */
export function crankTaskUrl(base: string, auction: PublicKey, lookupTable: PublicKey) {
  return `${base}?auction=${auction.toBase58()}&lut=${lookupTable.toBase58()}`;
}

export function auctionFromTaskUrl(url: string): string | null {
  const m = /[?&]auction=([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(url);
  return m ? m[1] : null;
}
