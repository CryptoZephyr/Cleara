import { Program, type Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";
import tuktukIdl from "../idl/tuktuk.json";
import { TASK_QUEUE, TUKTUK_PROGRAM_ID, auctionFromTaskUrl } from "../../shared/tuktuk";
import { connection } from "./chain";

const tuktuk = new Program(tuktukIdl as Idl, { connection });

export interface SettleTask {
  address: string;
  runAt: number | null;
}

interface TaskData {
  trigger: { timestamp?: [{ toNumber(): number }] };
  transaction: { remoteV0?: { url: string } };
}

/** The pending TukTuk task that will settle `auction`, if any. Tasks close once they run. */
export async function findSettleTask(auction: string): Promise<SettleTask | null> {
  const accounts = await connection.getProgramAccounts(TUKTUK_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ memcmp: { offset: 8, bytes: TASK_QUEUE.toBase58() } }],
  });
  for (const { pubkey, account } of accounts) {
    let t: TaskData;
    try {
      t = tuktuk.coder.accounts.decode("taskV0", account.data) as TaskData;
    } catch {
      continue;
    }
    const url = t.transaction.remoteV0?.url;
    if (url && auctionFromTaskUrl(url) === auction) return { address: pubkey.toBase58(), runAt: t.trigger.timestamp?.[0].toNumber() ?? null };
  }
  return null;
}

/** Whether a settlement transaction was executed by a TukTuk crank rather than a person. */
export async function settledByTuktuk(signature: string): Promise<boolean> {
  const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  return !!tx?.transaction.message.staticAccountKeys.some((k: PublicKey) => k.equals(TUKTUK_PROGRAM_ID));
}

/** undefined while loading, null when no task is pending. Re-checks every 15s so the status follows the crank. */
export function useSettleTask(auction: string, enabled: boolean) {
  const [task, setTask] = useState<SettleTask | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => findSettleTask(auction).then((t) => live && setTask(t), () => live && setTask((prev) => prev ?? null));
    load();
    const t = setInterval(load, 15000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [auction, enabled]);
  return enabled ? task : null;
}
