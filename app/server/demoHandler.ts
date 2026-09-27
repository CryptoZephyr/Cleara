import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { SIDE_BUY, STATUS_SETTLED, formatAtoms, parseAtoms, quoteCeil } from "../shared/cleara";
import { CONFIG, assetByMint } from "../shared/config";
import { SCENARIOS, type ScenarioId } from "../shared/scenarios";
import { baseAta, botKeypair, createEvent, fundIxs, makeProgram, parseSecret, quoteAta, send } from "./operator";
import { attestIx } from "./sas";

const DEMO_OPEN_SECS = 240;
const DEMO_SETTLE_SECS = 86400;
const BASE_GRANT = "200";
const QUOTE_GRANT = "2";
const SOL_GRANT = 0.02;
const MIN_OPERATOR_SOL = 0.5;
const OPERATOR_USDC_RESERVE = 8n;
const MAX_BASE = 1000n;
const MAX_QUOTE = 10n;
const MAX_OPEN_PER_WALLET = 2;
const MAX_OPEN_TOTAL = 12;

class DemoError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function balance(conn: Connection, ata: PublicKey) {
  try {
    return BigInt((await conn.getTokenAccountBalance(ata, "confirmed")).value.amount);
  } catch {
    return 0n;
  }
}

/** Tops up a wallet with synthetic tokens and a little devnet SOL, only when it is running low. */
function atoms(raw: unknown, cap: bigint): bigint {
  if (typeof raw !== "string" || !/^\d{1,30}$/.test(raw)) return 0n;
  const n = BigInt(raw);
  return n > cap ? cap : n;
}

function grant(have: bigint, floor: bigint, want: bigint, step: bigint): bigint {
  const target = want > floor ? want : floor;
  if (have >= target) return 0n;
  const gap = target - have;
  return gap > step ? gap : step;
}

async function fundWallet(conn: Connection, wallet: PublicKey, mint: string, want: { base?: unknown; quote?: unknown } = {}) {
  const operator = parseSecret(process.env.CLEARA_OPERATOR_SECRET!);
  const asset = assetByMint(mint);
  if (!asset) throw new Error("Unknown synthetic asset.");
  const operatorSol = await conn.getBalance(operator.publicKey, "confirmed");
  if (operatorSol < MIN_OPERATOR_SOL * LAMPORTS_PER_SOL) throw new DemoError("The demo operator is low on devnet SOL. Please try again later.", 503);
  const bUnit = 10n ** BigInt(asset.decimals);
  const qUnit = 10n ** BigInt(CONFIG.quoteDecimals);
  const [base, quote, sol] = await Promise.all([balance(conn, baseAta(asset, wallet)), balance(conn, quoteAta(wallet)), conn.getBalance(wallet, "confirmed")]);
  const baseGrant = grant(base, 50n * bUnit, atoms(want.base, MAX_BASE * bUnit), BigInt(BASE_GRANT) * bUnit);
  const wanted = grant(quote, BigInt(QUOTE_GRANT) * qUnit, atoms(want.quote, MAX_QUOTE * qUnit), BigInt(QUOTE_GRANT) * qUnit);
  const pool = (await balance(conn, quoteAta(operator.publicKey))) - OPERATOR_USDC_RESERVE * qUnit;
  const quoteGrant = wanted > 0n && pool >= wanted ? wanted : 0n;
  const quoteNote = wanted > 0n && quoteGrant === 0n ? ` The demo's test USDC pool is empty, so get ${CONFIG.quoteSymbol} for this wallet from ${CONFIG.quoteFaucet} (Solana Devnet).` : "";
  const needSol = sol < 0.01 * LAMPORTS_PER_SOL;
  if (baseGrant === 0n && quoteGrant === 0n && !needSol) return { signature: null, message: quoteNote.trim() || "This wallet already has enough demo funds." };
  const ixs = fundIxs(operator, asset, wallet, formatAtoms(baseGrant, asset.decimals), formatAtoms(quoteGrant, CONFIG.quoteDecimals));
  if (needSol) ixs.push(SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: wallet, lamports: Math.round(SOL_GRANT * LAMPORTS_PER_SOL) }));
  const signature = await send(conn, operator, ixs);
  const parts = [baseGrant > 0n && `${formatAtoms(baseGrant, asset.decimals)} ${asset.symbol}`, quoteGrant > 0n && `${formatAtoms(quoteGrant, CONFIG.quoteDecimals)} ${CONFIG.quoteSymbol}`, needSol && `${SOL_GRANT} devnet SOL`].filter(Boolean);
  return { signature, message: `Sent ${parts.join(", ")} to this wallet (test tokens, Devnet only).${quoteNote}` };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.CLEARA_OPERATOR_SECRET) return res.status(503).json({ error: "The demo operator is not configured on this deployment." });
  let body: { action?: string; wallet?: string; asset?: string; scenario?: string; base?: unknown; quote?: unknown };
  try {
    const parsed: unknown = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!parsed || typeof parsed !== "object") throw new Error("empty");
    body = parsed as typeof body;
  } catch {
    return res.status(400).json({ error: "Send a JSON request body." });
  }
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(body.wallet ?? "");
  } catch {
    return res.status(400).json({ error: "Invalid wallet address." });
  }
  const conn = new Connection(process.env.RPC_URL ?? CONFIG.rpc, "confirmed");
  try {
    if (body.action === "fund") return res.json(await fundWallet(conn, wallet, body.asset ?? "", { base: body.base, quote: body.quote }));
    if (body.action === "event") {
      const asset = assetByMint(body.asset ?? "");
      const scenario = SCENARIOS[body.scenario as ScenarioId];
      if (!asset || !scenario) return res.status(400).json({ error: "Unknown asset or scenario." });
      const operator = parseSecret(process.env.CLEARA_OPERATOR_SECRET);
      const now = Math.floor(Date.now() / 1000);
      const open = (await makeProgram(conn, operator).account.auction.all([{ memcmp: { offset: 8, bytes: operator.publicKey.toBase58() } }])).filter(
        (x) => x.account.status !== STATUS_SETTLED && x.account.deadline.toNumber() > now
      );
      if (open.filter((x) => x.account.roster.slice(0, x.account.rosterLen).some((r) => r.participant.equals(wallet))).length >= MAX_OPEN_PER_WALLET)
        throw new DemoError(`This wallet already has ${MAX_OPEN_PER_WALLET} demo events open. Try again once one closes (about ${Math.ceil(DEMO_OPEN_SECS / 60)} minutes).`, 429);
      if (open.length >= MAX_OPEN_TOTAL) throw new DemoError("Too many demo events are open right now. Try again in a few minutes, or use the seeded events.", 429);
      const pool = await balance(conn, quoteAta(operator.publicKey));
      const need = scenario.orders
        .filter((o) => o.side === SIDE_BUY)
        .reduce((n, o) => n + quoteCeil(parseAtoms(o.qty, asset.decimals)!, parseAtoms(o.price, CONFIG.quoteDecimals)!, asset.decimals), 0n);
      if (pool < need)
        throw new DemoError(`The demo's test USDC pool is too low to fund the bot buyers right now. Try the seeded events, or top up the operator from ${CONFIG.quoteFaucet}.`, 503);
      const attest = await attestIx(conn, operator, wallet);
      if (attest.length) await send(conn, operator, attest);
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
      await fundWallet(conn, wallet, asset.mint);
      return res.json({ auction: ev.auction.toBase58(), deadline: ev.deadline });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    if (e instanceof DemoError) return res.status(e.status).json({ error: e.message });
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(502).json({ error: /429/.test(msg) ? "Public Devnet RPC is rate-limiting. Try again in a few seconds." : `Devnet request failed: ${msg.slice(0, 200)}` });
  }
}
