import devnet from "../src/config/devnet.json" with { type: "json" };

export interface AssetConfig {
  mint: string;
  symbol: string;
  name: string;
  kind: string;
  description: string;
  decimals: number;
  reference: { symbol: string; name: string; mint: string; decimals: number };
}

export interface DevnetConfig {
  cluster: "devnet";
  rpc: string;
  programId: string;
  operator: string;
  quoteMint: string;
  quoteSymbol: string;
  quoteDecimals: number;
  feeAccount: string;
  usdcMainnet: string;
  assets: AssetConfig[];
  bots: string[];
}

export const CONFIG = devnet as DevnetConfig;

export const assetByMint = (mint: string) => CONFIG.assets.find((a) => a.mint === mint);
