import { AnchorProvider, BN, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createHash, createPrivateKey, sign } from "node:crypto";
import tuktukIdl from "../src/idl/tuktuk.json" with { type: "json" };
import { CONFIG, assetByMint, type AssetConfig } from "../shared/config";
import { PROGRAM_ID, STATUS_SETTLED, vaultPdas } from "../shared/cleara";
import { TASK_QUEUE, auctionFromTaskUrl, crankTaskUrl, taskPda, taskQueueAuthorityPda } from "../shared/tuktuk";
import { baseAta, makeProgram, quoteAta, send, settleIx } from "./operator";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

interface TaskQueueData {
  capacity: number;
  taskBitmap: Buffer;
}
interface TaskData {
  taskQueue: PublicKey;
  queuedAt: BN;
  transaction: { remoteV0?: { url: string; signer: PublicKey } };
}

export async function fetchTuktuk<T>(conn: Connection, program: Program, name: "taskQueueV0" | "taskV0" | "tuktukConfigV0", key: PublicKey): Promise<T | null> {
  const info = await conn.getAccountInfo(key, "confirmed");
  return info ? (program.coder.accounts.decode(name, info.data) as T) : null;
}

export function tuktukProgram(conn: Connection, payer: Keypair) {
  return new Program(tuktukIdl as Idl, new AnchorProvider(conn, new Wallet(payer), { commitment: "confirmed" }));
}

/** Key that signs remote settle transactions for TukTuk; derived from the operator so no extra secret is needed. */
export function crankSigner(operator: Keypair): Keypair {
  return Keypair.fromSeed(createHash("sha256").update(operator.secretKey).update("cleara-tuktuk-remote-signer").digest());
}

function ed25519Sign(signer: Keypair, msg: Buffer) {
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(signer.secretKey.slice(0, 32))]);
  return sign(null, msg, createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
}

function freeTaskIds(bitmap: Buffer, capacity: number) {
  const ids: number[] = [];
  for (let id = 0; id < capacity; id++) if (!(bitmap[id >> 3] & (1 << (id & 7)))) ids.push(id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

/** One lookup table per event holds every account the settle transaction can touch, so 8 orders fit in one transaction. */
async function createEventLookupTable(conn: Connection, operator: Keypair, auction: PublicKey, asset: AssetConfig, participants: PublicKey[]) {
  const { baseVault, quoteVault } = vaultPdas(auction);
  const keys = [
    PROGRAM_ID, auction, new PublicKey(asset.mint), new PublicKey(CONFIG.quoteMint), baseVault, quoteVault, new PublicKey(CONFIG.feeAccount),
    TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, TASK_QUEUE, operator.publicKey, SystemProgram.programId, SYSVAR_INSTRUCTIONS_PUBKEY,
    ...participants.flatMap((p) => [baseAta(asset, p), quoteAta(p)]),
  ];
  const addresses = [...new Map(keys.map((k) => [k.toBase58(), k])).values()];
  const extend = (lookupTable: PublicKey, i: number) =>
    AddressLookupTableProgram.extendLookupTable({ lookupTable, authority: operator.publicKey, payer: operator.publicKey, addresses: addresses.slice(i, i + 20) });
  let lookupTable: PublicKey | undefined;
  for (let attempt = 0; !lookupTable; attempt++) {
    const [createIx, table] = AddressLookupTableProgram.createLookupTable({
      authority: operator.publicKey,
      payer: operator.publicKey,
      recentSlot: (await conn.getSlot("confirmed")) - 2,
    });
    try {
      await send(conn, operator, [createIx, extend(table, 0)]);
      lookupTable = table;
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  for (let i = 20; i < addresses.length; i += 20) await send(conn, operator, [extend(lookupTable, i)]);
  return lookupTable;
}

export interface ScheduledSettle {
  task: PublicKey;
  lookupTable: PublicKey;
  signature: string;
}

/** Queues a TukTuk task that settles `auction` once its deadline passes. The manual Settle button keeps working either way. */
export async function scheduleSettle(
  conn: Connection,
  operator: Keypair,
  auction: PublicKey,
  crankUrl: string
): Promise<ScheduledSettle> {
  const tuktuk = tuktukProgram(conn, operator);
  const a = await makeProgram(conn, operator).account.auction.fetch(auction, "confirmed");
  const asset = assetByMint(a.baseMint.toBase58());
  if (!asset) throw new Error("Unknown asset");
  if (a.quoteMint.toBase58() !== CONFIG.quoteMint) throw new Error("Only events quoted in the current USDC mint can be auto-settled.");
  const participants = a.roster.slice(0, a.rosterLen).map((r) => r.participant);
  const lookupTable = await createEventLookupTable(conn, operator, auction, asset, participants);
  const url = crankTaskUrl(crankUrl, auction, lookupTable);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const queue = await fetchTuktuk<TaskQueueData>(conn, tuktuk, "taskQueueV0", TASK_QUEUE);
    if (!queue) throw new Error("The TukTuk task queue does not exist. Run scripts/tuktuk.ts setup.");
    const id = freeTaskIds(Buffer.from(queue.taskBitmap), queue.capacity)[0];
    if (id === undefined) throw new Error("The TukTuk task queue is full.");
    const task = taskPda(TASK_QUEUE, id);
    const ix = await tuktuk.methods
      .queueTaskV0({
        id,
        trigger: { timestamp: [a.deadline] },
        transaction: { remoteV0: { url, signer: crankSigner(operator).publicKey } },
        crankReward: null,
        freeTasks: 0,
        description: `settle ${auction.toBase58().slice(0, 8)}`,
      })
      .accountsPartial({
        payer: operator.publicKey,
        queueAuthority: operator.publicKey,
        taskQueueAuthority: taskQueueAuthorityPda(TASK_QUEUE, operator.publicKey),
        taskQueue: TASK_QUEUE,
        task,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    try {
      return { task, lookupTable, signature: await send(conn, operator, [ix]) };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

interface Meta {
  pubkey: PublicKey;
  isWritable: boolean;
}

/** Same layout TukTuk's compileTransaction produces: writable accounts first, then read-only. No signers are needed for settle. */
function compile(ixs: TransactionInstruction[]) {
  const metas = new Map<string, Meta>();
  const add = (pubkey: PublicKey, isWritable: boolean) => {
    const k = pubkey.toBase58();
    const m = metas.get(k);
    metas.set(k, { pubkey, isWritable: (m?.isWritable ?? false) || isWritable });
  };
  for (const ix of ixs) {
    add(ix.programId, false);
    for (const k of ix.keys) {
      if (k.isSigner) throw new Error("Remote settle transactions cannot require signers.");
      add(k.pubkey, k.isWritable);
    }
  }
  const sorted = [...metas.values()].sort((a, b) => Number(b.isWritable) - Number(a.isWritable));
  const index = new Map(sorted.map((m, i) => [m.pubkey.toBase58(), i]));
  return {
    accounts: sorted,
    transaction: {
      numRwSigners: 0,
      numRoSigners: 0,
      numRw: sorted.filter((m) => m.isWritable).length,
      accounts: [] as PublicKey[],
      instructions: ixs.map((ix) => ({
        programIdIndex: index.get(ix.programId.toBase58())!,
        accounts: Buffer.from(ix.keys.map((k) => index.get(k.pubkey.toBase58())!)),
        data: Buffer.from(ix.data),
      })),
      signerSeeds: [] as Buffer[][],
    },
  };
}

function verificationHash(task: PublicKey, queuedAt: BN, accounts: Meta[]) {
  const h = createHash("sha256").update(task.toBuffer()).update(queuedAt.toArrayLike(Buffer, "le", 8));
  for (const a of accounts) h.update(Buffer.concat([a.pubkey.toBuffer(), Buffer.from([a.isWritable ? 1 : 0, 0])]));
  return h.digest();
}

export class CrankError extends Error {}

/** Answers a TukTuk crank turner with a signed settle transaction built from the event's current order book. */
export async function remoteSettle(conn: Connection, operator: Keypair, req: { task: string; taskQueuedAt: string; taskQueue: string }) {
  const taskKey = new PublicKey(req.task);
  if (req.taskQueue !== TASK_QUEUE.toBase58()) throw new CrankError("Unknown task queue.");
  const tuktuk = tuktukProgram(conn, operator);
  const task = await fetchTuktuk<TaskData>(conn, tuktuk, "taskV0", taskKey);
  if (!task || !task.taskQueue.equals(TASK_QUEUE)) throw new CrankError("Unknown task.");
  const queuedAt = task.queuedAt;
  if (queuedAt.toString() !== req.taskQueuedAt) throw new CrankError("Task was re-queued.");
  const remote = task.transaction.remoteV0;
  const signer = crankSigner(operator);
  if (!remote || !remote.signer.equals(signer.publicKey)) throw new CrankError("Task is not a Cleara settle task.");
  const auction = new PublicKey(auctionFromTaskUrl(remote.url) ?? "");
  const lut = /[?&]lut=([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(remote.url)?.[1];

  const a = await makeProgram(conn, operator).account.auction.fetchNullable(auction, "confirmed");
  if (!a) throw new CrankError("Event not found.");
  const ixs =
    a.status === STATUS_SETTLED
      ? [new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(`cleara: ${auction.toBase58()} already settled`) })]
      : (await settleIx(conn, operator, auction)).filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  const { accounts, transaction } = compile(ixs);
  const message = await tuktuk.coder.accounts.encode("remoteTaskTransactionV0", {
    verificationHash: [...verificationHash(taskKey, queuedAt, accounts)],
    transaction,
  });
  return {
    transaction: message.toString("base64"),
    signature: ed25519Sign(signer, message).toString("base64"),
    remaining_accounts: accounts.map((m) => ({ pubkey: m.pubkey.toBase58(), is_signer: false, is_writable: m.isWritable })),
    lookup_tables: lut ? [lut] : [],
  };
}
