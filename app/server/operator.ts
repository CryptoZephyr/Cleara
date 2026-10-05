import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import idl from "../src/idl/cleara.json" with { type: "json" };
import type { Cleara } from "../src/idl/cleara";
import { CONFIG, type AssetConfig } from "../shared/config";
import { SIDE_BUY, SIDE_EMPTY, auctionPda, parseAtoms, quoteCeil, vaultPdas } from "../shared/cleara";
import { runAsTeam, teamAddresses } from "./squads";
import { SCENARIOS, type ScenarioId, type SeedOrder } from "../shared/scenarios";

export function parseSecret(raw: string): Keypair {
  const t = raw.trim();
  if (t.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)));
  const ALPH = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of t) n = n * 58n + BigInt(ALPH.indexOf(c));
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of t) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

export function botKeypair(operator: Keypair, i: number): Keypair {
  const seed = createHash("sha256")
    .update(operator.secretKey)
    .update(`cleara-demo-bot-${i}`)
    .digest();
  return Keypair.fromSeed(seed);
}

export function makeProgram(conn: Connection, operator: Keypair) {
  const provider = new AnchorProvider(conn, new Wallet(operator), { commitment: "confirmed" });
  return new Program<Cleara>(idl as Cleara, provider);
}

export async function send(conn: Connection, payer: Keypair, ixs: TransactionInstruction[], signers: Keypair[] = []) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = payer.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(payer, ...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
  const result = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (result.value.err) throw new Error(`Transaction failed onchain: ${JSON.stringify(result.value.err)}`);
  return sig;
}

export function baseAta(asset: AssetConfig, owner: PublicKey) {
  return getAssociatedTokenAddressSync(new PublicKey(asset.mint), owner, true, TOKEN_2022_PROGRAM_ID);
}

export function quoteAta(owner: PublicKey) {
  return getAssociatedTokenAddressSync(new PublicKey(CONFIG.quoteMint), owner, true, TOKEN_PROGRAM_ID);
}

export async function tokenBalance(conn: Connection, ata: PublicKey) {
  try {
    return BigInt((await conn.getTokenAccountBalance(ata, "confirmed")).value.amount);
  } catch {
    return 0n;
  }
}

export function quoteTransferIx(operator: Keypair, to: PublicKey, atoms: bigint) {
  return createTransferCheckedInstruction(quoteAta(operator.publicKey), new PublicKey(CONFIG.quoteMint), to, operator.publicKey, atoms, CONFIG.quoteDecimals, [], TOKEN_PROGRAM_ID);
}

/** Moves idle test USDC from the demo bots back to the operator so it can be reused for the next event. */
export async function sweepBots(conn: Connection, operator: Keypair) {
  const ixs: TransactionInstruction[] = [];
  const signers: Keypair[] = [];
  for (let i = 0; i < 4; i++) {
    const bot = botKeypair(operator, i);
    const ata = quoteAta(bot.publicKey);
    const have = await tokenBalance(conn, ata);
    if (have === 0n) continue;
    ixs.push(createTransferCheckedInstruction(ata, new PublicKey(CONFIG.quoteMint), quoteAta(operator.publicKey), bot.publicKey, have, CONFIG.quoteDecimals, [], TOKEN_PROGRAM_ID));
    signers.push(bot);
  }
  if (ixs.length) await send(conn, operator, ixs, signers);
}

/** Idempotently creates token accounts for `owner`, mints synthetic base tokens and sends test USDC from the operator's balance. */
export function fundIxs(operator: Keypair, asset: AssetConfig, owner: PublicKey, base: string, quote: string) {
  const baseMint = new PublicKey(asset.mint);
  const quoteMint = new PublicKey(CONFIG.quoteMint);
  const b = baseAta(asset, owner);
  const q = quoteAta(owner);
  const ixs = [
    createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, b, owner, baseMint, TOKEN_2022_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, q, owner, quoteMint, TOKEN_PROGRAM_ID),
  ];
  const baseAtoms = parseAtoms(base, asset.decimals)!;
  const quoteAtoms = parseAtoms(quote, CONFIG.quoteDecimals)!;
  if (baseAtoms > 0n)
    ixs.push(createMintToInstruction(baseMint, b, operator.publicKey, baseAtoms, [], TOKEN_2022_PROGRAM_ID));
  if (quoteAtoms > 0n)
    ixs.push(quoteTransferIx(operator, q, quoteAtoms));
  return ixs;
}

export interface CreateEventOpts {
  asset: AssetConfig;
  openSecs: number;
  settleSecs: number;
  minQty: string;
  feeBps: number;
  roster: { participant: PublicKey; allowance: number }[];
  seed: SeedOrder[];
  /** Create the event from the Squads team vault (2-of-3 approval) instead of the operator wallet. */
  team?: boolean;
}

export async function createEvent(conn: Connection, operator: Keypair, o: CreateEventOpts) {
  const program = makeProgram(conn, operator);
  const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  const issuer = o.team ? teamAddresses(operator).vault : operator.publicKey;
  const auction = auctionPda(issuer, id);
  const { baseVault, quoteVault } = vaultPdas(auction);
  const now = Math.floor(Date.now() / 1000);
  const slot = await conn.getSlot("confirmed");
  const chainNow = (await conn.getBlockTime(slot)) ?? now;
  const deadline = chainNow + o.openSecs;
  const baseMint = new PublicKey(o.asset.mint);
  const quoteMint = new PublicKey(CONFIG.quoteMint);
  const createIx = await program.methods
    .createAuction(
      new BN(id.toString()),
      new BN(deadline),
      new BN(deadline + o.settleSecs),
      new BN(parseAtoms(o.minQty, o.asset.decimals)!.toString()),
      o.feeBps,
      o.roster
    )
    .accountsPartial({
      issuer,
      auction,
      baseMint,
      quoteMint,
      baseVault,
      quoteVault,
      feeAccount: new PublicKey(CONFIG.feeAccount),
      baseTokenProgram: TOKEN_2022_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const team = o.team ? await runAsTeam(conn, operator, [createIx]) : null;
  if (!team) await send(conn, operator, [createIx]);

  await sweepBots(conn, operator);
  const need = new Map<number, bigint>();
  for (const s of o.seed)
    if (s.side === SIDE_BUY)
      need.set(s.bot, (need.get(s.bot) ?? 0n) + quoteCeil(parseAtoms(s.qty, o.asset.decimals)!, parseAtoms(s.price, CONFIG.quoteDecimals)!, o.asset.decimals));
  const topUps: TransactionInstruction[] = [];
  for (const i of new Set(o.seed.map((s) => s.bot))) {
    const bot = botKeypair(operator, i).publicKey;
    const ata = quoteAta(bot);
    topUps.push(createAssociatedTokenAccountIdempotentInstruction(operator.publicKey, ata, bot, new PublicKey(CONFIG.quoteMint), TOKEN_PROGRAM_ID));
    const amount = need.get(i) ?? 0n;
    const have = await tokenBalance(conn, ata);
    if (have < amount) topUps.push(quoteTransferIx(operator, ata, amount - have));
  }
  if (topUps.length) await send(conn, operator, topUps);

  for (let i = 0; i < o.seed.length; i += 2) {
    const chunk = o.seed.slice(i, i + 2);
    const ixs: TransactionInstruction[] = [];
    const signers: Keypair[] = [];
    for (const s of chunk) {
      const bot = botKeypair(operator, s.bot);
      signers.push(bot);
      ixs.push(
        await program.methods
          .placeOrder(
            s.side,
            new BN(parseAtoms(s.price, CONFIG.quoteDecimals)!.toString()),
            new BN(parseAtoms(s.qty, o.asset.decimals)!.toString())
          )
          .accountsPartial({
            owner: bot.publicKey,
            auction,
            baseMint,
            quoteMint,
            ownerBase: baseAta(o.asset, bot.publicKey),
            ownerQuote: quoteAta(bot.publicKey),
            baseVault,
            quoteVault,
            baseTokenProgram: TOKEN_2022_PROGRAM_ID,
            quoteTokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction()
      );
    }
    await send(conn, operator, ixs, signers);
  }
  return { auction, id, deadline, team };
}

export async function settleIx(conn: Connection, operator: Keypair, auction: PublicKey) {
  const program = makeProgram(conn, operator);
  const a = await program.account.auction.fetch(auction, "confirmed");
  const asset = CONFIG.assets.find((x) => x.mint === a.baseMint.toBase58());
  if (!asset) throw new Error("Unknown asset");
  const rem: AccountMeta[] = [];
  for (const o of a.orders) {
    if (o.side === SIDE_EMPTY) continue;
    rem.push({ pubkey: baseAta(asset, o.owner), isSigner: false, isWritable: true });
    rem.push({ pubkey: quoteAta(o.owner), isSigner: false, isWritable: true });
  }
  const { baseVault, quoteVault } = vaultPdas(auction);
  const ix = await program.methods
    .settle()
    .accountsPartial({
      auction,
      baseMint: a.baseMint,
      quoteMint: a.quoteMint,
      baseVault,
      quoteVault,
      feeAccount: a.feeAccount,
      baseTokenProgram: TOKEN_2022_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(rem)
    .instruction();
  return [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ix];
}

export function scenarioSeed(id: ScenarioId) {
  return SCENARIOS[id].orders;
}
