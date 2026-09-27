import { PublicKey } from "@solana/web3.js";

export const SAS_PROGRAM_ID = new PublicKey("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");
export const SAS_CREDENTIAL_NAME = "Cleara Demo Issuer";
export const SAS_SCHEMA_NAME = "cleara-approved-participant";
export const SAS_SCHEMA_VERSION = 1;

const enc = new TextEncoder();

export function attestationPda(credential: PublicKey, schema: PublicKey, wallet: PublicKey) {
  return PublicKey.findProgramAddressSync([enc.encode("attestation"), credential.toBytes(), schema.toBytes(), wallet.toBytes()], SAS_PROGRAM_ID)[0];
}

export interface AttestationInfo {
  address: string;
  wallet: string;
  signer: string;
  expiry: number;
}

/** Decodes an SAS attestation account: u8 discriminator, nonce, credential, schema, u32-prefixed data, signer, i64 expiry, token account. */
export function decodeAttestation(address: string, data: Uint8Array): AttestationInfo | null {
  if (data.length < 1 + 96 + 4) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const len = view.getUint32(97, true);
  const at = 101 + len;
  if (data.length < at + 40) return null;
  return {
    address,
    wallet: new PublicKey(data.slice(1, 33)).toBase58(),
    signer: new PublicKey(data.slice(at, at + 32)).toBase58(),
    expiry: Number(view.getBigInt64(at + 32, true)),
  };
}

/** Borsh-encodes `{ status: String, scope: String }`, the schema's two string fields. */
export function encodeApproval(status: string, scope: string) {
  const parts = [status, scope].map((s) => enc.encode(s));
  const out = new Uint8Array(parts.reduce((n, p) => n + 4 + p.length, 0));
  const view = new DataView(out.buffer);
  let o = 0;
  for (const p of parts) {
    view.setUint32(o, p.length, true);
    out.set(p, o + 4);
    o += 4 + p.length;
  }
  return out;
}
