import devnet from "../src/config/devnet.json" with { type: "json" };

export interface AssetConfig {
  mint: string;
  symbol: string;
  name: string;
  kind: string;
  description: string;
  decimals: number;
}

export interface DevnetConfig {
  cluster: "devnet";
  rpc: string;
  programId: string;
  operator: string;
  quoteMint: string;
  quoteSymbol: string;
  quoteDecimals: number;
  quoteName: string;
  quoteFaucet: string;
  retiredQuoteMints: string[];
  feeAccount: string;
  sas?: { credential: string; schema: string };
  /** Squads multisig whose vault issues team events. */
  squads?: { multisig: string; vault: string; threshold: number; members: number };
  assets: AssetConfig[];
  bots: string[];
}

export const CONFIG = devnet as DevnetConfig;

/** Wallets whose events Cleara lists: the demo operator and, if configured, the Squads team vault. */
export const ISSUERS = [CONFIG.operator, ...(CONFIG.squads ? [CONFIG.squads.vault] : [])];

export const assetByMint = (mint: string) => CONFIG.assets.find((a) => a.mint === mint);
