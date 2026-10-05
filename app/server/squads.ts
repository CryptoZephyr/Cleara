import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { createHash } from "node:crypto";
import { send } from "./operator";

export const TEAM_THRESHOLD = 2;
const VAULT_MIN_LAMPORTS = 0.03 * LAMPORTS_PER_SOL;
const VAULT_TOP_UP_LAMPORTS = 0.1 * LAMPORTS_PER_SOL;

function derived(operator: Keypair, label: string): Keypair {
  return Keypair.fromSeed(createHash("sha256").update(operator.secretKey).update(label).digest());
}

/** Demo issuer team: the operator plus two derived member keys. Any two of the three approve a proposal. */
export function teamMembers(operator: Keypair): Keypair[] {
  return [operator, derived(operator, "cleara-squads-member-1"), derived(operator, "cleara-squads-member-2")];
}

export function teamAddresses(operator: Keypair) {
  const createKey = derived(operator, "cleara-squads-create-key");
  const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
  const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
  return { createKey, multisigPda, vault };
}

/** Creates the 2-of-3 Squads multisig on Devnet (idempotent) and makes sure its vault can pay rent. */
export async function setupTeam(conn: Connection, operator: Keypair) {
  const { createKey, multisigPda, vault } = teamAddresses(operator);
  if (!(await conn.getAccountInfo(multisigPda))) {
    const [programConfig] = multisig.getProgramConfigPda({});
    const { treasury } = await multisig.accounts.ProgramConfig.fromAccountAddress(conn, programConfig);
    const ix = multisig.instructions.multisigCreateV2({
      treasury,
      creator: operator.publicKey,
      multisigPda,
      configAuthority: null,
      threshold: TEAM_THRESHOLD,
      members: teamMembers(operator).map((m) => ({ key: m.publicKey, permissions: multisig.types.Permissions.all() })),
      timeLock: 0,
      createKey: createKey.publicKey,
      rentCollector: null,
    });
    console.log("multisig created", await send(conn, operator, [ix], [createKey]));
  }
  await fundVault(conn, operator, vault);
  return { multisigPda, vault };
}

async function fundVault(conn: Connection, operator: Keypair, vault: PublicKey) {
  if ((await conn.getBalance(vault, "confirmed")) >= VAULT_MIN_LAMPORTS) return;
  await send(conn, operator, [SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: vault, lamports: VAULT_TOP_UP_LAMPORTS })]);
}

export interface TeamExecution {
  transactionIndex: bigint;
  proposed: string;
  approved: string;
  executed: string;
}

/** Runs `ixs` signed by the team vault: propose, collect two member approvals, then execute. */
export async function runAsTeam(conn: Connection, operator: Keypair, ixs: TransactionInstruction[]): Promise<TeamExecution> {
  const { multisigPda, vault } = teamAddresses(operator);
  await fundVault(conn, operator, vault);
  const [, second] = teamMembers(operator);
  const ms = await multisig.accounts.Multisig.fromAccountAddress(conn, multisigPda, "confirmed");
  const transactionIndex = BigInt(ms.transactionIndex.toString()) + 1n;
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const proposed = await send(conn, operator, [
    multisig.instructions.vaultTransactionCreate({
      multisigPda,
      transactionIndex,
      creator: operator.publicKey,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage: new TransactionMessage({ payerKey: vault, recentBlockhash: blockhash, instructions: ixs }),
    }),
    multisig.instructions.proposalCreate({ multisigPda, transactionIndex, creator: operator.publicKey }),
  ]);
  const approved = await send(
    conn,
    operator,
    [operator, second].map((m) => multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: m.publicKey })),
    [second]
  );
  const { instruction } = await multisig.instructions.vaultTransactionExecute({ connection: conn, multisigPda, transactionIndex, member: operator.publicKey });
  const executed = await send(conn, operator, [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), instruction]);
  return { transactionIndex, proposed, approved, executed };
}
