import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { CONFIG } from "../../shared/config";
import { attestationPda, decodeAttestation, type AttestationInfo } from "../../shared/sas";
import { connection } from "./chain";

export const sasEnabled = () => Boolean(CONFIG.sas);

/** Looks up each wallet's Cleara approved-participant attestation on the Solana Attestation Service. */
export async function fetchAttestations(wallets: string[]): Promise<Map<string, AttestationInfo | null>> {
  const out = new Map<string, AttestationInfo | null>();
  if (!CONFIG.sas || wallets.length === 0) return out;
  const credential = new PublicKey(CONFIG.sas.credential);
  const schema = new PublicKey(CONFIG.sas.schema);
  const pdas = wallets.map((w) => attestationPda(credential, schema, new PublicKey(w)));
  const infos = await connection.getMultipleAccountsInfo(pdas, "confirmed");
  wallets.forEach((w, i) => {
    const info = infos[i];
    const att = info ? decodeAttestation(pdas[i].toBase58(), info.data) : null;
    out.set(w, att && att.wallet === w && att.signer === CONFIG.operator ? att : null);
  });
  return out;
}

export function useAttestations(wallets: string[]) {
  const key = wallets.join(",");
  const [state, setState] = useState<{ key: string; map: Map<string, AttestationInfo | null> } | null>(null);
  useEffect(() => {
    let live = true;
    fetchAttestations(key ? key.split(",") : [])
      .then((map) => live && setState({ key, map }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key]);
  return state?.key === key ? state.map : null;
}

export const isValid = (a: AttestationInfo | null | undefined, now: number) => Boolean(a && a.expiry > now);
