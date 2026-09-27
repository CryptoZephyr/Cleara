import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { chainTimeOffset, fetchAuctions, watchAuctions, type AuctionView } from "./chain";

interface Store {
  auctions: AuctionView[] | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  now: number;
}

const Ctx = createContext<Store | null>(null);

export function AuctionsProvider({ children }: { children: ReactNode }) {
  const [auctions, setAuctions] = useState<AuctionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setAuctions(await fetchAuctions());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unwatch = watchAuctions((a) =>
      setAuctions((prev) => {
        const list = prev ?? [];
        const rest = list.filter((x) => x.address !== a.address);
        return [a, ...rest].sort((x, y) => Number(y.id - x.id));
      })
    );
    const poll = setInterval(refresh, 60000);
    const clock = setInterval(() => setTick(Date.now()), 1000);
    chainTimeOffset().then(setOffset).catch(() => undefined);
    const drift = setInterval(() => chainTimeOffset().then(setOffset).catch(() => undefined), 60000);
    return () => {
      unwatch();
      clearInterval(poll);
      clearInterval(clock);
      clearInterval(drift);
    };
  }, [refresh]);

  return (
    <Ctx.Provider value={{ auctions, error, loading, refresh, now: Math.floor(tick / 1000 + offset) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside AuctionsProvider");
  return s;
}
