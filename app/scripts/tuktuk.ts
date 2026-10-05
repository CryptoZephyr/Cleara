/**
 * TukTuk auto-settle on devnet.
 *   setup               creates the reusable "cleara-settle" task queue (1 SOL refundable deposit) and the operator's queue authority
 *   schedule <auction>  queues a settle task for an existing event (demo events are scheduled by /api/demo automatically)
 */
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { CONFIG } from "../shared/config";
import { DEFAULT_CRANK_URL, TASK_QUEUE, TASK_QUEUE_NAME, TUKTUK_PROGRAM_ID, taskQueueAuthorityPda } from "../shared/tuktuk";
import { send } from "../server/operator";
import { fetchTuktuk, scheduleSettle, tuktukProgram } from "../server/tuktuk";

const conn = new Connection(process.env.RPC_URL ?? CONFIG.rpc, "confirmed");
const op = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/cleara-operator.json`, "utf8"))));
const tuktuk = tuktukProgram(conn, op);

async function setup() {
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("tuktuk_config")], TUKTUK_PROGRAM_ID);
  const nameHash = createHash("sha256").update(TASK_QUEUE_NAME).digest();
  const [mapping] = PublicKey.findProgramAddressSync([Buffer.from("task_queue_name_mapping"), config.toBuffer(), nameHash], TUKTUK_PROGRAM_ID);
  if (!(await conn.getAccountInfo(mapping))) {
    const cfg = await fetchTuktuk<{ nextTaskQueueId: number }>(conn, tuktuk, "tuktukConfigV0", config);
    if (!cfg) throw new Error("TukTuk is not deployed on this cluster.");
    const { nextTaskQueueId } = cfg;
    const id = Buffer.alloc(4);
    id.writeUInt32LE(nextTaskQueueId);
    const [taskQueue] = PublicKey.findProgramAddressSync([Buffer.from("task_queue"), config.toBuffer(), id], TUKTUK_PROGRAM_ID);
    const ix = await tuktuk.methods
      .initializeTaskQueueV0({ minCrankReward: new BN(1_000_000), name: TASK_QUEUE_NAME, capacity: 20, lookupTables: [], staleTaskAge: 60 * 60 * 48 })
      .accountsPartial({ payer: op.publicKey, tuktukConfig: config, updateAuthority: op.publicKey, taskQueue, taskQueueNameMapping: mapping, systemProgram: SystemProgram.programId })
      .instruction();
    console.log("task queue", taskQueue.toBase58(), await send(conn, op, [ix]), "(update TASK_QUEUE in shared/tuktuk.ts)");
    return;
  }
  const authority = taskQueueAuthorityPda(TASK_QUEUE, op.publicKey);
  if (!(await conn.getAccountInfo(authority))) {
    const ix = await tuktuk.methods.addQueueAuthorityV0().accountsPartial({ payer: op.publicKey, updateAuthority: op.publicKey, queueAuthority: op.publicKey, taskQueueAuthority: authority, taskQueue: TASK_QUEUE, systemProgram: SystemProgram.programId }).instruction();
    console.log("queue authority", await send(conn, op, [ix]));
  }
  console.log("task queue ready", TASK_QUEUE.toBase58());
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "setup") return setup();
  if (cmd === "schedule" && arg) {
    const r = await scheduleSettle(conn, op, new PublicKey(arg), process.env.CLEARA_CRANK_URL ?? DEFAULT_CRANK_URL);
    return console.log("task", r.task.toBase58(), "lookup table", r.lookupTable.toBase58(), r.signature);
  }
  console.log("usage: tuktuk.ts setup | schedule <auction>");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
