/** Creates the Cleara demo SAS credential and approved-participant schema on devnet, attests the demo bots, and records the addresses in the config. */
import { Connection, Keypair } from "@solana/web3.js";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { CONFIG } from "../shared/config";
import { botKeypair, send } from "../server/operator";
import { attestIx, setupIxs } from "../server/sas";

const CFG_PATH = process.env.CFG_PATH ?? new URL("../src/config/devnet.json", import.meta.url);
const conn = new Connection(process.env.RPC_URL ?? CONFIG.rpc, "confirmed");
const op = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/cleara-operator.json`, "utf8"))));

async function main() {
  const { credential, schema, credentialIx, schemaIx } = await setupIxs(op);
  if (!(await conn.getAccountInfo(credential))) console.log("credential", await send(conn, op, [credentialIx]));
  if (!(await conn.getAccountInfo(schema))) console.log("schema", await send(conn, op, [schemaIx]));
  const sas = { credential: credential.toBase58(), schema: schema.toBase58() };
  CONFIG.sas = sas;
  const cfg = JSON.parse(readFileSync(CFG_PATH, "utf8"));
  writeFileSync(CFG_PATH, JSON.stringify({ ...cfg, sas }, null, 2) + "\n");
  for (let i = 0; i < 4; i++) {
    const ix = await attestIx(conn, op, botKeypair(op, i).publicKey);
    if (ix) console.log("attested bot", i, await send(conn, op, [ix]));
  }
  console.log(sas);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
