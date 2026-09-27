import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { AccountRole, address, createNoopSigner, type Instruction } from "@solana/kit";
import {
  deriveCredentialPda,
  deriveSchemaPda,
  getCreateAttestationInstruction,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
} from "sas-lib";
import { CONFIG } from "../shared/config";
import { SAS_CREDENTIAL_NAME, SAS_SCHEMA_NAME, SAS_SCHEMA_VERSION, attestationPda, encodeApproval } from "../shared/sas";

const ATTESTATION_DAYS = 30;

function toWeb3(ix: Instruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: (ix.accounts ?? []).map((a) => ({
      pubkey: new PublicKey(a.address),
      isSigner: a.role === AccountRole.READONLY_SIGNER || a.role === AccountRole.WRITABLE_SIGNER,
      isWritable: a.role === AccountRole.WRITABLE || a.role === AccountRole.WRITABLE_SIGNER,
    })),
    data: Buffer.from(ix.data ?? new Uint8Array()),
  });
}

export async function sasAddresses(operator: PublicKey) {
  const [credential] = await deriveCredentialPda({ authority: address(operator.toBase58()), name: SAS_CREDENTIAL_NAME });
  const [schema] = await deriveSchemaPda({ credential, name: SAS_SCHEMA_NAME, version: SAS_SCHEMA_VERSION });
  return { credential: new PublicKey(credential), schema: new PublicKey(schema) };
}

/** Instructions that create the demo issuer credential and approved-participant schema. */
export async function setupIxs(operator: Keypair) {
  const signer = createNoopSigner(address(operator.publicKey.toBase58()));
  const { credential, schema } = await sasAddresses(operator.publicKey);
  return {
    credential,
    schema,
    credentialIx: toWeb3(
      getCreateCredentialInstruction({ payer: signer, authority: signer, credential: address(credential.toBase58()), name: SAS_CREDENTIAL_NAME, signers: [signer.address] })
    ),
    schemaIx: toWeb3(
      getCreateSchemaInstruction({
        payer: signer,
        authority: signer,
        credential: address(credential.toBase58()),
        schema: address(schema.toBase58()),
        name: SAS_SCHEMA_NAME,
        description: "Wallet approved by the event issuer to place orders in Cleara Devnet events",
        layout: new Uint8Array([12, 12]),
        fieldNames: ["status", "scope"],
      })
    ),
  };
}

/** Returns an instruction attesting `wallet` as an approved participant, or null if a live attestation already exists. */
export async function attestIx(conn: Connection, operator: Keypair, wallet: PublicKey): Promise<TransactionInstruction | null> {
  if (!CONFIG.sas) return null;
  const credential = new PublicKey(CONFIG.sas.credential);
  const schema = new PublicKey(CONFIG.sas.schema);
  const pda = attestationPda(credential, schema, wallet);
  if (await conn.getAccountInfo(pda, "confirmed")) return null;
  const signer = createNoopSigner(address(operator.publicKey.toBase58()));
  return toWeb3(
    getCreateAttestationInstruction({
      payer: signer,
      authority: signer,
      credential: address(credential.toBase58()),
      schema: address(schema.toBase58()),
      attestation: address(pda.toBase58()),
      nonce: address(wallet.toBase58()),
      data: encodeApproval("approved", "cleara-devnet-demo"),
      expiry: BigInt(Math.floor(Date.now() / 1000) + ATTESTATION_DAYS * 86400),
    })
  );
}
