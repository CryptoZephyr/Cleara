import { SIDE_BUY, SIDE_SELL } from "./cleara";

export type ScenarioId = "crossing" | "partial" | "no-overlap";

export interface SeedOrder {
  bot: number;
  side: typeof SIDE_BUY | typeof SIDE_SELL;
  price: string;
  qty: string;
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  summary: string;
  orders: SeedOrder[];
}

/** Synthetic seed orders placed by labelled demo bots. Prices are in the quote token per whole base token. */
export const SCENARIOS: Record<ScenarioId, Scenario> = {
  crossing: {
    id: "crossing",
    title: "Crossing orders",
    summary: "Buy and sell limits overlap, so volume can clear at one price.",
    orders: [
      { bot: 0, side: SIDE_SELL, price: "0.90", qty: "6" },
      { bot: 1, side: SIDE_SELL, price: "0.95", qty: "4" },
      { bot: 2, side: SIDE_BUY, price: "1.00", qty: "5" },
      { bot: 3, side: SIDE_BUY, price: "0.96", qty: "3" },
    ],
  },
  partial: {
    id: "partial",
    title: "Partial fill",
    summary: "More tokens are offered than buyers want at overlapping prices.",
    orders: [
      { bot: 0, side: SIDE_SELL, price: "0.88", qty: "12" },
      { bot: 1, side: SIDE_SELL, price: "0.92", qty: "8" },
      { bot: 2, side: SIDE_BUY, price: "0.93", qty: "7" },
      { bot: 3, side: SIDE_BUY, price: "0.80", qty: "4" },
    ],
  },
  "no-overlap": {
    id: "no-overlap",
    title: "No overlap",
    summary: "Every buyer's limit is below every seller's limit, so nothing can trade yet.",
    orders: [
      { bot: 0, side: SIDE_SELL, price: "1.10", qty: "6" },
      { bot: 1, side: SIDE_SELL, price: "1.05", qty: "4" },
      { bot: 2, side: SIDE_BUY, price: "0.95", qty: "5" },
      { bot: 3, side: SIDE_BUY, price: "0.90", qty: "3" },
    ],
  },
};
