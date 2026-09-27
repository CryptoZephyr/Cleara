import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  createMint,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  freezeAccount,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import { Cleara } from "../target/types/cleara";

// All orders in these tests are synthetic: fake tokens, fake participants, devnet/localnet only.

const BUY = 1;
const SELL = 2;
const DEC = 6;
const ONE = 10 ** DEC;
const FEE_BPS = 50;

const tok = (n: number) => new BN(Math.round(n * ONE));
const price = (usd: number) => new BN(Math.round(usd * ONE));

describe("cleara (synthetic orders)", () => {
  const provider = new anchor.AnchorProvider(
    anchor.AnchorProvider.env().connection,
    anchor.AnchorProvider.env().wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.cleara as Program<Cleara>;
  const conn = new anchor.web3.Connection(
    provider.connection.rpcEndpoint,
    "confirmed"
  );
  const issuer = (provider.wallet as anchor.Wallet).payer;

  let baseMint: PublicKey;
  let quoteMint: PublicKey;
  let feeAccount: PublicKey;
  let nextId = Date.now();

  type Party = { kp: Keypair; base: PublicKey; quote: PublicKey };

  async function chainNow(): Promise<number> {
    const slot = await conn.getSlot("confirmed");
    return (await conn.getBlockTime(slot)) as number;
  }

  async function waitUntil(ts: number) {
    while ((await chainNow()) <= ts)
      await new Promise((r) => setTimeout(r, 400));
  }

  async function party(baseAmt = 0, quoteAmt = 0): Promise<Party> {
    const kp = Keypair.generate();
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: issuer.publicKey,
          toPubkey: kp.publicKey,
          lamports: 50_000_000,
        })
      ),
      [issuer]
    );
    const base = (
      await getOrCreateAssociatedTokenAccount(
        conn,
        issuer,
        baseMint,
        kp.publicKey,
        false,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      )
    ).address;
    const quote = (
      await getOrCreateAssociatedTokenAccount(
        conn,
        issuer,
        quoteMint,
        kp.publicKey
      )
    ).address;
    if (baseAmt > 0)
      await mintTo(
        conn,
        issuer,
        baseMint,
        base,
        issuer,
        BigInt(baseAmt * ONE),
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
    if (quoteAmt > 0)
      await mintTo(
        conn,
        issuer,
        quoteMint,
        quote,
        issuer,
        BigInt(quoteAmt * ONE)
      );
    return { kp, base, quote };
  }

  function pdas(id: number) {
    const [auction] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("auction"),
        issuer.publicKey.toBuffer(),
        new BN(id).toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    const [baseVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("base_vault"), auction.toBuffer()],
      program.programId
    );
    const [quoteVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("quote_vault"), auction.toBuffer()],
      program.programId
    );
    return { auction, baseVault, quoteVault };
  }

  async function createAuction(
    roster: { p: Party; allowance?: number }[],
    openSecs = 6,
    settleSecs = 30,
    mint = baseMint
  ) {
    const id = nextId++;
    const now = await chainNow();
    const deadline = now + openSecs;
    const settleBy = deadline + settleSecs;
    const p = pdas(id);
    await program.methods
      .createAuction(
        new BN(id),
        new BN(deadline),
        new BN(settleBy),
        tok(1),
        FEE_BPS,
        roster.map((r) => ({
          participant: r.p.kp.publicKey,
          allowance: r.allowance ?? 1,
        }))
      )
      .accountsPartial({
        issuer: issuer.publicKey,
        auction: p.auction,
        baseMint: mint,
        quoteMint,
        baseVault: p.baseVault,
        quoteVault: p.quoteVault,
        feeAccount,
        baseTokenProgram: TOKEN_2022_PROGRAM_ID,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    return { id, deadline, settleBy, ...p };
  }

  type A = Awaited<ReturnType<typeof createAuction>>;

  function orderAccounts(a: A, who: Party) {
    return {
      auction: a.auction,
      baseMint,
      quoteMint,
      ownerBase: who.base,
      ownerQuote: who.quote,
      baseVault: a.baseVault,
      quoteVault: a.quoteVault,
      baseTokenProgram: TOKEN_2022_PROGRAM_ID,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    };
  }

  async function place(a: A, who: Party, side: number, px: BN, qty: BN) {
    await program.methods
      .placeOrder(side, px, qty)
      .accountsPartial({ owner: who.kp.publicKey, ...orderAccounts(a, who) })
      .signers([who.kp])
      .rpc();
  }

  async function settleRemaining(a: A, parties: Party[]) {
    const state = await program.account.auction.fetch(a.auction);
    const rem: anchor.web3.AccountMeta[] = [];
    for (const o of state.orders) {
      if (o.side === 0) continue;
      const p = parties.find((x) => x.kp.publicKey.equals(o.owner))!;
      rem.push({ pubkey: p.base, isSigner: false, isWritable: true });
      rem.push({ pubkey: p.quote, isSigner: false, isWritable: true });
    }
    return rem;
  }

  function settleIx(a: A, rem: anchor.web3.AccountMeta[]) {
    return program.methods
      .settle()
      .accountsPartial({
        auction: a.auction,
        baseMint,
        quoteMint,
        baseVault: a.baseVault,
        quoteVault: a.quoteVault,
        feeAccount,
        baseTokenProgram: TOKEN_2022_PROGRAM_ID,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(rem)
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      ]);
  }

  async function settle(a: A, parties: Party[]) {
    return settleIx(a, await settleRemaining(a, parties)).rpc();
  }

  const bal = async (acct: PublicKey, program2022 = false) =>
    Number(
      (
        await getAccount(
          conn,
          acct,
          "confirmed",
          program2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
        )
      ).amount
    );

  async function expectErr(p: Promise<unknown>, code: string) {
    try {
      await p;
    } catch (e) {
      assert.include(String(e), code);
      return;
    }
    assert.fail(`expected ${code}`);
  }

  async function vaultsEmpty(a: A) {
    assert.equal(await bal(a.baseVault, true), 0);
    assert.equal(await bal(a.quoteVault), 0);
  }

  before(async () => {
    baseMint = await createMint(
      conn,
      issuer,
      issuer.publicKey,
      issuer.publicKey,
      DEC,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    quoteMint = await createMint(conn, issuer, issuer.publicKey, null, DEC);
    feeAccount = (
      await getOrCreateAssociatedTokenAccount(
        conn,
        issuer,
        quoteMint,
        issuer.publicKey
      )
    ).address;
  });

  it("Case 1: overlapping orders clear at one price", async () => {
    const s1 = await party(100);
    const s2 = await party(50);
    const b1 = await party(0, 200);
    const b2 = await party(0, 200);
    const a = await createAuction([{ p: s1 }, { p: s2 }, { p: b1 }, { p: b2 }]);
    await place(a, s1, SELL, price(0.9), tok(100));
    await place(a, s2, SELL, price(0.95), tok(50));
    await place(a, b1, BUY, price(1.0), tok(100));
    await place(a, b2, BUY, price(0.97), tok(50));
    const fee0 = await bal(feeAccount);
    await waitUntil(a.deadline);
    await settle(a, [s1, s2, b1, b2]);

    const st = await program.account.auction.fetch(a.auction);
    assert.equal(st.clearingPrice.toNumber(), 0.95 * ONE);
    assert.equal(st.clearedVolume.toNumber(), 150 * ONE);
    assert.equal(await bal(b1.base, true), 100 * ONE);
    assert.equal(await bal(b2.base, true), 50 * ONE);
    assert.equal(await bal(b1.quote), 200 * ONE - 95 * ONE);
    assert.equal(await bal(b2.quote), 200 * ONE - 47.5 * ONE);
    assert.equal(await bal(s1.quote), 95 * ONE * (1 - FEE_BPS / 1e4));
    assert.equal(await bal(s2.quote), 47.5 * ONE * (1 - FEE_BPS / 1e4));
    assert.equal((await bal(feeAccount)) - fee0, 142.5 * ONE * (FEE_BPS / 1e4));
    await vaultsEmpty(a);
    await expectErr(settle(a, [s1, s2, b1, b2]), "NotOpen");
  });

  it("Case 2: not enough buyers -> partial fill and refund", async () => {
    const s = await party(100);
    const b = await party(0, 100);
    const a = await createAuction([{ p: s }, { p: b }]);
    await place(a, s, SELL, price(0.8), tok(100));
    await place(a, b, BUY, price(0.9), tok(40));
    await waitUntil(a.deadline);
    await settle(a, [s, b]);
    const st = await program.account.auction.fetch(a.auction);
    assert.equal(st.clearingPrice.toNumber(), 0.8 * ONE);
    assert.equal(st.orders[0].filled.toNumber(), 40 * ONE);
    assert.equal(await bal(s.base, true), 60 * ONE);
    assert.equal(await bal(b.base, true), 40 * ONE);
    assert.equal(await bal(b.quote), 100 * ONE - 32 * ONE);
    await vaultsEmpty(a);
  });

  it("Case 3: no price overlap -> nothing trades, everyone refunded", async () => {
    const s = await party(100);
    const b = await party(0, 100);
    const a = await createAuction([{ p: s }, { p: b }]);
    await place(a, s, SELL, price(1.2), tok(100));
    await place(a, b, BUY, price(1.0), tok(50));
    await waitUntil(a.deadline);
    await settle(a, [s, b]);
    const st = await program.account.auction.fetch(a.auction);
    assert.equal(st.clearedVolume.toNumber(), 0);
    assert.equal(await bal(s.base, true), 100 * ONE);
    assert.equal(await bal(b.quote), 100 * ONE);
    await vaultsEmpty(a);
  });

  it("Case 4: never settled -> anyone can refund after expiry", async () => {
    const s = await party(100);
    const b = await party(0, 100);
    const a = await createAuction([{ p: s }, { p: b }], 4, 3);
    await place(a, s, SELL, price(0.9), tok(100));
    await place(a, b, BUY, price(1.0), tok(50));
    const refund = (slot: number, who: Party) =>
      program.methods
        .refundExpired(slot)
        .accountsPartial({ ...orderAccounts(a, who) })
        .rpc();
    await expectErr(refund(0, s), "NotExpired");
    await waitUntil(a.settleBy);
    await expectErr(settle(a, [s, b]), "SettlementExpired");
    await expectErr(refund(0, b), "WrongAccounts");
    await refund(0, s);
    await refund(1, b);
    assert.equal(await bal(s.base, true), 100 * ONE);
    assert.equal(await bal(b.quote), 100 * ONE);
    await vaultsEmpty(a);
  });

  it("Guards: roster, allowance, self-trade, size, deadline", async () => {
    const s = await party(100);
    const b = await party(0, 100);
    const outsider = await party(100);
    const a = await createAuction([{ p: s, allowance: 2 }, { p: b }], 8);
    await expectErr(place(a, outsider, SELL, price(1), tok(10)), "NotOnRoster");
    await expectErr(place(a, s, SELL, price(1), new BN(10)), "OrderTooSmall");
    await place(a, s, SELL, price(1), tok(10));
    await expectErr(place(a, s, BUY, price(1), tok(10)), "SelfTrade");
    await place(a, s, SELL, price(1.1), tok(10));
    await expectErr(place(a, s, SELL, price(1), tok(10)), "AllowanceUsed");
    await expectErr(settle(a, [s]), "BeforeDeadline");
    await program.methods
      .cancelOrder(0)
      .accountsPartial({ owner: s.kp.publicKey, ...orderAccounts(a, s) })
      .signers([s.kp])
      .rpc();
    assert.equal(await bal(s.base, true), 90 * ONE);
    await place(a, s, SELL, price(1), tok(10));
    await waitUntil(a.deadline);
    await expectErr(place(a, b, BUY, price(1), tok(10)), "PastDeadline");
  });

  it("Guards: settlement rejects missing, reordered or substituted accounts", async () => {
    const s = await party(100);
    const b = await party(0, 100);
    const thief = await party();
    const a = await createAuction([{ p: s }, { p: b }]);
    await place(a, s, SELL, price(0.9), tok(50));
    await place(a, b, BUY, price(1.0), tok(50));
    await waitUntil(a.deadline);
    const good = await settleRemaining(a, [s, b]);
    await expectErr(settleIx(a, good.slice(0, 2)).rpc(), "WrongAccounts");
    await expectErr(
      settleIx(a, [good[2], good[3], good[0], good[1]]).rpc(),
      "WrongAccounts"
    );
    const swapped = [...good];
    swapped[3] = { pubkey: thief.quote, isSigner: false, isWritable: true };
    await expectErr(settleIx(a, swapped).rpc(), "WrongAccounts");
    await settleIx(a, good).rpc();
    await vaultsEmpty(a);
  });

  it("Restrictions: a frozen account blocks atomic settlement but not others' refunds", async () => {
    const s1 = await party(100);
    const s2 = await party(100);
    const b = await party(0, 100);
    const a = await createAuction([{ p: s1 }, { p: s2 }, { p: b }], 6, 4);
    await place(a, s1, SELL, price(0.9), tok(30));
    await place(a, s2, SELL, price(0.9), tok(30));
    await place(a, b, BUY, price(1.0), tok(30));
    await freezeAccount(
      conn,
      issuer,
      s2.base,
      baseMint,
      issuer,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await waitUntil(a.deadline);
    await expectErr(settle(a, [s1, s2, b]), "frozen");
    await waitUntil(a.settleBy);
    const refund = (slot: number, who: Party) =>
      program.methods
        .refundExpired(slot)
        .accountsPartial({ ...orderAccounts(a, who) })
        .rpc();
    await refund(0, s1);
    await refund(2, b);
    await expectErr(refund(1, s2), "frozen");
    assert.equal(await bal(s1.base, true), 100 * ONE);
    assert.equal(await bal(b.quote), 100 * ONE);
    assert.equal(await bal(a.baseVault, true), 30 * ONE);
  });

  it("Rejects Token-2022 mints with non-allowlisted extensions", async () => {
    const mintKp = Keypair.generate();
    const len = getMintLen([ExtensionType.TransferFeeConfig]);
    const lamports = await conn.getMinimumBalanceForRentExemption(len);
    await sendAndConfirmTransaction(
      conn,
      new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: issuer.publicKey,
          newAccountPubkey: mintKp.publicKey,
          space: len,
          lamports,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeTransferFeeConfigInstruction(
          mintKp.publicKey,
          issuer.publicKey,
          issuer.publicKey,
          100,
          BigInt(1e9),
          TOKEN_2022_PROGRAM_ID
        ),
        createInitializeMintInstruction(
          mintKp.publicKey,
          DEC,
          issuer.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID
        )
      ),
      [issuer, mintKp]
    );
    const p = await party();
    await expectErr(
      createAuction([{ p }], 6, 30, mintKp.publicKey),
      "UnsupportedExtension"
    );
  });

  it("Capacity: 8 orders settle in one transaction (benchmark)", async () => {
    const sellers = await Promise.all([1, 2, 3, 4].map(() => party(100)));
    const buyers = await Promise.all([1, 2, 3, 4].map(() => party(0, 200)));
    const a = await createAuction(
      [...sellers, ...buyers].map((p) => ({ p })),
      10
    );
    const sp = [0.85, 0.9, 0.95, 1.0];
    const bp = [1.05, 1.0, 0.97, 0.92];
    for (let i = 0; i < 4; i++)
      await place(a, sellers[i], SELL, price(sp[i]), tok(60 + i * 7));
    for (let i = 0; i < 4; i++)
      await place(a, buyers[i], BUY, price(bp[i]), tok(55 + i * 11));
    await waitUntil(a.deadline);
    const rem = await settleRemaining(a, [...sellers, ...buyers]);
    const tx = await settleIx(a, rem).transaction();
    tx.feePayer = issuer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.sign(issuer);
    const size = tx.serialize().length;
    const sig = await sendAndConfirmTransaction(conn, tx, [issuer], {
      commitment: "confirmed",
    });
    const info = await conn.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const st = await program.account.auction.fetch(a.auction);
    console.log(
      `      8-order settle: ${size} bytes (legacy limit 1232, v1 limit 4096), ${info?.meta?.computeUnitsConsumed} CU, ` +
        `price ${st.clearingPrice.toNumber() / ONE}, volume ${
          st.clearedVolume.toNumber() / ONE
        }`
    );
    assert.isAtMost(size, 1232);
    await vaultsEmpty(a);
  });
});
