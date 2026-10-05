export interface FundResult {
  signature: string | null;
  message: string;
}
export interface DemoEventResult {
  auction: string;
  deadline: number;
  autoSettleTask: string | null;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({ error: `Request failed (${res.status})` }))) as T & { error?: string };
  if (!res.ok || data.error) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export const requestFunds = (wallet: string, asset: string, need: { base?: bigint; quote?: bigint } = {}) =>
  post<FundResult>("/api/demo", { action: "fund", wallet, asset, base: need.base?.toString(), quote: need.quote?.toString() });
export const requestDemoEvent = (wallet: string, asset: string, scenario: string) =>
  post<DemoEventResult>("/api/demo", { action: "event", wallet, asset, scenario });
