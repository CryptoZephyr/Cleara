/** One-time devnet setup: operator wallet, synthetic base mints, Circle Devnet USDC fee account, demo bots. Writes src/config/devnet.json (public keys only). */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  ExtensionType,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { createInitializeInstruction, pack, type TokenMetadata } from "@solana/spl-token-metadata";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const CFG_PATH = new URL("../src/config/devnet.json", import.meta.url);
const OWNER_PATH = `${homedir()}/.config/solana/cleara-owner.json`;
const OP_PATH = `${homedir()}/.config/solana/cleara-operator.json`;
const CIRCLE_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const load = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));

const ASSETS = [
  {
    symbol: "NRTH",
    name: "Northwind Robotics Series B (synthetic)",
    kind: "Private-company share token",
    description: "Fictional late-stage robotics company. Holders want an exit before any IPO.",
  },
  {
    symbol: "HLCN",
    name: "Halcyon Solar Credit Note (synthetic)",
    kind: "Private credit note",
    description: "Fictional solar-project credit note with quarterly coupons and a small holder base.",
  },
  {
    symbol: "ORCH",
    name: "Orchard Lane Residences (synthetic)",
    kind: "Real-estate fund unit",
    description: "Fictional residential real-estate fund. Units rarely trade between redemption windows.",
  },
];

async function createMetadataMint(op: Keypair, symbol: string, name: string) {
  const mint = Keypair.generate();
  const md: TokenMetadata = { mint: mint.publicKey, name, symbol, uri: "", additionalMetadata: [["network", "devnet-synthetic"]], updateAuthority: op.publicKey };
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const lamports = await conn.getMinimumBalanceForRentExemption(mintLen + TYPE_SIZE + LENGTH_SIZE + pack(md).length);
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: op.publicKey, newAccountPubkey: mint.publicKey, space: mintLen, lamports, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMetadataPointerInstruction(mint.publicKey, op.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint.publicKey, 6, op.publicKey, op.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: mint.publicKey, updateAuthority: op.publicKey, mint: mint.publicKey, mintAuthority: op.publicKey, name, symbol, uri: "" })
  );
  await sendAndConfirmTransaction(conn, tx, [op, mint]);
  return mint.publicKey;
}

async function main() {
  const owner = load(OWNER_PATH);
  if (!existsSync(OP_PATH)) writeFileSync(OP_PATH, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
  const op = load(OP_PATH);
  console.log("operator", op.publicKey.toBase58());
  const bal = await conn.getBalance(op.publicKey);
  if (bal < 0.8 * LAMPORTS_PER_SOL) {
    const amt = Math.round(1.2 * LAMPORTS_PER_SOL) - bal;
    await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: op.publicKey, lamports: amt })), [owner]);
    console.log("funded operator", amt / LAMPORTS_PER_SOL);
  }
  const quoteMint = new PublicKey(CIRCLE_DEVNET_USDC);
  const fee = await getOrCreateAssociatedTokenAccount(conn, op, quoteMint, op.publicKey);
  console.log("quote mint", quoteMint.toBase58());
  const assets = [];
  for (const a of ASSETS) {
    const mint = await createMetadataMint(op, a.symbol, a.name);
    console.log(a.symbol, mint.toBase58());
    assets.push({ mint: mint.toBase58(), symbol: a.symbol, name: a.name, kind: a.kind, description: a.description, decimals: 6 });
  }
  const bots = [0, 1, 2, 3].map((i) =>
    Keypair.fromSeed(createHash("sha256").update(op.secretKey).update(`cleara-demo-bot-${i}`).digest()).publicKey.toBase58()
  );
  const cfg = {
    cluster: "devnet",
    rpc: "https://api.devnet.solana.com",
    programId: "AnVHa4HHZHhUTepWnSGwxDLUEmkKyAuD6sHeKPtTSY6W",
    operator: op.publicKey.toBase58(),
    quoteMint: quoteMint.toBase58(),
    quoteSymbol: "USDC",
    quoteDecimals: 6,
    quoteName: "Circle test USDC (Devnet)",
    quoteFaucet: "https://faucet.circle.com",
    retiredQuoteMints: ["Fk454Hd66rMQ2kRtNsCRF3m6XKZgGy8d8RWPvvVaDrCX"],
    feeAccount: fee.address.toBase58(),
    assets,
    bots,
  };
  writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2) + "\n");
  console.log("wrote config");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
