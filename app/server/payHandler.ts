import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AnchorProvider, BN, Program, type Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import idl from "../src/idl/cleara.json" with { type: "json" };
import type { Cleara } from "../src/idl/cleara";
import { CONFIG, ISSUERS } from "../shared/config";
import { SIDE_BUY, SIDE_EMPTY, SIDE_SELL, STATUS_SETTLED, parseAtoms, quoteCeil, vaultPdas } from "../shared/cleara";
import { attestationPda, decodeAttestation } from "../shared/sas";

const ICON = "https://cleara-ten.vercel.app/cleara-logo.png";

class PayError extends Error {}

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Accept-Encoding");
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function balance(conn: Connection, ata: PublicKey) {
  try {
    return BigInt((await conn.getTokenAccountBalance(ata, "confirmed")).value.amount);
  } catch {
    return 0n;
  }
}

/** Builds an unsigned place-order transaction for a Solana Pay transaction request. */
async function buildOrder(conn: Connection, account: PublicKey, q: VercelRequest["query"]) {
  const auctionKey = new PublicKey(one(q.auction));
  const side = Number(one(q.side));
  if (side !== SIDE_BUY && side !== SIDE_SELL) throw new PayError("Unknown order side.");
  const readOnly = { publicKey: PublicKey.default } as unknown as Wallet;
  const program = new Program<Cleara>(idl as Cleara, new AnchorProvider(conn, readOnly, { commitment: "confirmed" }));
  const a = await program.account.auction.fetchNullable(auctionKey, "confirmed");
  if (!a || !ISSUERS.includes(a.issuer.toBase58())) throw new PayError("This is not a Cleara Devnet event.");
  const price = parseAtoms(one(q.price), a.quoteDecimals);
  const qty = parseAtoms(one(q.qty), a.baseDecimals);
  if (!price || !qty) throw new PayError("Enter a price and quantity greater than zero.");
  const slot = await conn.getSlot("confirmed");
  const now = (await conn.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
  if (a.status === STATUS_SETTLED || now >= a.deadline.toNumber()) throw new PayError("This event is closed for new orders.");
  const entry = a.roster.slice(0, a.rosterLen).find((r) => r.participant.equals(account));
  if (!entry) throw new PayError("This wallet is not an approved participant in this event.");
  if (entry.active >= entry.allowance) throw new PayError("This wallet has used all of its order slots in this event.");
  if (a.orders.every((o) => o.side !== SIDE_EMPTY)) throw new PayError("All 8 order slots are taken.");
  if (a.orders.some((o) => o.side !== SIDE_EMPTY && o.side !== side && o.owner.equals(account))) throw new PayError("Self-trading is not allowed.");
  if (CONFIG.sas) {
    const pda = attestationPda(new PublicKey(CONFIG.sas.credential), new PublicKey(CONFIG.sas.schema), account);
    const info = await conn.getAccountInfo(pda, "confirmed");
    const att = info && decodeAttestation(pda.toBase58(), info.data);
    if (!att || att.expiry <= now) throw new PayError("This wallet has no valid Cleara participant credential.");
  }
  const baseMint = a.baseMint;
  const quoteMint = a.quoteMint;
  const ownerBase = getAssociatedTokenAddressSync(baseMint, account, true, TOKEN_2022_PROGRAM_ID);
  const ownerQuote = getAssociatedTokenAddressSync(quoteMint, account, true, TOKEN_PROGRAM_ID);
  const lock = side === SIDE_BUY ? quoteCeil(qty, price, a.baseDecimals) : qty;
  if ((await balance(conn, side === SIDE_BUY ? ownerQuote : ownerBase)) < lock)
    throw new PayError(side === SIDE_BUY ? `Not enough ${CONFIG.quoteSymbol}. Get test USDC at ${CONFIG.quoteFaucet}.` : "Not enough tokens to sell.");
  const { baseVault, quoteVault } = vaultPdas(auctionKey);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(account, ownerBase, account, baseMint, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(account, ownerQuote, account, quoteMint, TOKEN_PROGRAM_ID),
    await program.methods
      .placeOrder(side, new BN(price.toString()), new BN(qty.toString()))
      .accountsPartial({
        owner: account,
        auction: auctionKey,
        baseMint,
        quoteMint,
        baseVault,
        quoteVault,
        ownerBase,
        ownerQuote,
        baseTokenProgram: TOKEN_2022_PROGRAM_ID,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction()
  );
  tx.feePayer = account;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  const verb = side === SIDE_BUY ? "Buy" : "Sell";
  return {
    transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
    message: `${verb} limit order on Cleara (Solana Devnet, test tokens only). Funds lock in the event escrow until settlement.`,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.json({ label: "Cleara (Devnet)", icon: ICON });
  if (req.method !== "POST") return res.status(405).json({ message: "Use GET or POST." });
  let account: PublicKey;
  try {
    const body: unknown = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    account = new PublicKey((body as { account?: string } | null)?.account ?? "");
  } catch {
    return res.status(400).json({ message: "Send the wallet account in the request body." });
  }
  try {
    return res.json(await buildOrder(new Connection(process.env.RPC_URL ?? CONFIG.rpc, "confirmed"), account, req.query));
  } catch (e) {
    const msg = e instanceof PayError ? e.message : `Devnet request failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
    return res.status(e instanceof PayError ? 400 : 502).json({ message: msg });
  }
}
