/** Funds demo bots with base tokens (test USDC is topped up per event from the operator) and creates labelled synthetic events on devnet in several states. */
import { Connection, Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { CONFIG } from "../shared/config";
import { SCENARIOS } from "../shared/scenarios";
import { botKeypair, createEvent, fundIxs, send, settleIx } from "../server/operator";

const conn = new Connection(process.env.RPC_URL ?? CONFIG.rpc, "confirmed");
const op = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/cleara-operator.json`, "utf8"))));
const bots = [0, 1, 2, 3].map((i) => botKeypair(op, i));
const roster = bots.map((b) => ({ participant: b.publicKey, allowance: 1 }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const [NRTH, HLCN, ORCH] = CONFIG.assets;

async function waitChain(ts: number) {
  for (;;) {
    const t = await conn.getBlockTime(await conn.getSlot("confirmed"));
    if (t && t > ts) return;
    await sleep(2000);
  }
}

async function main() {
  if (process.argv.includes("--fund")) {
    for (const asset of CONFIG.assets)
      for (let i = 0; i < bots.length; i += 2)
        await send(conn, op, bots.slice(i, i + 2).flatMap((b) => fundIxs(op, asset, b.publicKey, "500", "0")));
    console.log("bots funded");
  }
  const DAY = 86400;
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  const run = (name: string) => !only || only.split(",").includes(name);
  const short = { openSecs: 25, minQty: "1", feeBps: 30 };
  const long = { openSecs: 6 * DAY, settleSecs: 2 * DAY, minQty: "1", feeBps: 30 };

  if (run("settled")) {
    const s1 = await createEvent(conn, op, { asset: ORCH, ...short, settleSecs: 3 * DAY, roster, seed: SCENARIOS.crossing.orders });
    await waitChain(s1.deadline);
    console.log("settled crossing", s1.auction.toBase58(), await send(conn, op, await settleIx(conn, op, s1.auction)));
    const s2 = await createEvent(conn, op, { asset: NRTH, ...short, settleSecs: 3 * DAY, roster, seed: SCENARIOS.partial.orders });
    await waitChain(s2.deadline);
    console.log("settled partial", s2.auction.toBase58(), await send(conn, op, await settleIx(conn, op, s2.auction)));
  }
  if (run("crossing")) console.log("open crossing", (await createEvent(conn, op, { asset: NRTH, ...long, roster, seed: SCENARIOS.crossing.orders })).auction.toBase58());
  if (run("expired")) console.log("expired (left unsettled for refunds)", (await createEvent(conn, op, { asset: HLCN, ...short, settleSecs: 30, roster, seed: SCENARIOS.crossing.orders })).auction.toBase58());
  if (run("no-overlap"))
    console.log("open no-overlap", (await createEvent(conn, op, { asset: HLCN, ...long, openSecs: 3 * DAY, roster, seed: SCENARIOS["no-overlap"].orders })).auction.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
