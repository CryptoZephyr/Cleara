/**
 * Squads issuer demo on Devnet.
 *   setup               create the 2-of-3 team multisig and fund its vault
 *   event [openSecs]    create a team-issued event (proposed, approved by 2 members, executed) and queue auto-settle
 */
import { Connection, Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { CONFIG } from "../shared/config";
import { SCENARIOS } from "../shared/scenarios";
import { DEFAULT_CRANK_URL } from "../shared/tuktuk";
import { botKeypair, createEvent } from "../server/operator";
import { setupTeam } from "../server/squads";
import { scheduleSettle } from "../server/tuktuk";

const conn = new Connection(process.env.RPC_URL ?? CONFIG.rpc, "confirmed");
const op = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/cleara-operator.json`, "utf8"))));
const DAY = 86400;

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "setup") {
    const { multisigPda, vault } = await setupTeam(conn, op);
    console.log("multisig", multisigPda.toBase58(), "vault", vault.toBase58());
    return;
  }
  if (cmd === "event") {
    const roster = [0, 1, 2, 3].map((i) => ({ participant: botKeypair(op, i).publicKey, allowance: 1 }));
    const ev = await createEvent(conn, op, {
      asset: CONFIG.assets[0],
      openSecs: arg ? Number(arg) : 3 * DAY,
      settleSecs: 2 * DAY,
      minQty: "1",
      feeBps: 30,
      roster,
      seed: SCENARIOS.crossing.orders,
      team: true,
    });
    console.log("event", ev.auction.toBase58(), "deadline", new Date(ev.deadline * 1000).toISOString());
    console.log("team tx", ev.team?.transactionIndex, "proposed", ev.team?.proposed, "approved", ev.team?.approved, "executed", ev.team?.executed);
    const s = await scheduleSettle(conn, op, ev.auction, process.env.CLEARA_CRANK_URL ?? DEFAULT_CRANK_URL);
    console.log("task", s.task.toBase58());
    return;
  }
  throw new Error("Usage: squads.ts setup | event [openSecs]");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
