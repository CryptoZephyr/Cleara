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
  assets: AssetConfig[];
  bots: string[];
}

export const CONFIG = devnet as DevnetConfig;

export const assetByMint = (mint: string) => CONFIG.assets.find((a) => a.mint === mint);
