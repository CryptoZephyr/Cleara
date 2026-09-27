import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { CONFIG, assetByMint } from "../shared/config";
import { SCENARIOS, type ScenarioId } from "../shared/scenarios";
import { baseAta, botKeypair, createEvent, fundIxs, parseSecret, quoteAta, send } from "./operator";

const DEMO_OPEN_SECS = 240;
const DEMO_SETTLE_SECS = 86400;
const BASE_GRANT = "200";
const QUOTE_GRANT = "500";
const SOL_GRANT = 0.02;

async function balance(conn: Connection, ata: PublicKey) {
  try {
    return BigInt((await conn.getTokenAccountBalance(ata, "confirmed")).value.amount);
  } catch {
    return 0n;
  }
}

/** Tops up a wallet with synthetic tokens and a little devnet SOL, only when it is running low. */
async function fundWallet(conn: Connection, wallet: PublicKey, mint: string) {
  const operator = parseSecret(process.env.CLEARA_OPERATOR_SECRET!);
  const asset = assetByMint(mint);
  if (!asset) throw new Error("Unknown synthetic asset.");
  const [base, quote, sol] = await Promise.all([balance(conn, baseAta(asset, wallet)), balance(conn, quoteAta(wallet)), conn.getBalance(wallet, "confirmed")]);
  const needBase = base < 50n * 10n ** BigInt(asset.decimals);
  const needQuote = quote < 100n * 10n ** BigInt(CONFIG.quoteDecimals);
  const needSol = sol < 0.01 * LAMPORTS_PER_SOL;
  if (!needBase && !needQuote && !needSol) return { signature: null, message: "This wallet already has enough demo funds." };
  const ixs = fundIxs(operator, asset, wallet, needBase ? BASE_GRANT : "0", needQuote ? QUOTE_GRANT : "0");
  if (needSol) ixs.push(SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: wallet, lamports: Math.round(SOL_GRANT * LAMPORTS_PER_SOL) }));
  const signature = await send(conn, operator, ixs);
  const parts = [needBase && `${BASE_GRANT} ${asset.symbol}`, needQuote && `${QUOTE_GRANT} ${CONFIG.quoteSymbol}`, needSol && `${SOL_GRANT} devnet SOL`].filter(Boolean);
  return { signature, message: `Sent ${parts.join(", ")} to this wallet (synthetic, Devnet only).` };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.CLEARA_OPERATOR_SECRET) return res.status(503).json({ error: "The demo operator is not configured on this deployment." });
  const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as { action?: string; wallet?: string; asset?: string; scenario?: string };
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(body.wallet ?? "");
  } catch {
    return res.status(400).json({ error: "Invalid wallet address." });
  }
  const conn = new Connection(process.env.RPC_URL ?? CONFIG.rpc, "confirmed");
  try {
    if (body.action === "fund") return res.json(await fundWallet(conn, wallet, body.asset ?? ""));
    if (body.action === "event") {
      const asset = assetByMint(body.asset ?? "");
      const scenario = SCENARIOS[body.scenario as ScenarioId];
      if (!asset || !scenario) return res.status(400).json({ error: "Unknown asset or scenario." });
      const operator = parseSecret(process.env.CLEARA_OPERATOR_SECRET);
      await fundWallet(conn, wallet, asset.mint);
      const bots = [0, 1, 2, 3].map((i) => botKeypair(operator, i));
      const roster = [...bots.map((b) => ({ participant: b.publicKey, allowance: 1 })), { participant: wallet, allowance: 2 }];
      const ev = await createEvent(conn, operator, {
        asset,
        openSecs: DEMO_OPEN_SECS,
        settleSecs: DEMO_SETTLE_SECS,
        minQty: "1",
        feeBps: 30,
        roster,
        seed: scenario.orders,
      });
      return res.json({ auction: ev.auction.toBase58(), deadline: ev.deadline });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(502).json({ error: /429/.test(msg) ? "Public Devnet RPC is rate-limiting. Try again in a few seconds." : `Devnet request failed: ${msg.slice(0, 200)}` });
  }
}
