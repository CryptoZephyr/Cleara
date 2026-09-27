import { useEffect, useMemo } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { RPC_URL } from "./lib/chain";
import { DemoWalletAdapter } from "./lib/demoWallet";
import { AuctionsProvider } from "./lib/store";
import { Footer, Page, TopBar } from "./components/Shell";
import { Window } from "./components/ui";
import Landing from "./pages/Landing";
import Events from "./pages/Events";
import EventDetail from "./pages/EventDetail";
import MyOrders from "./pages/MyOrders";
import Developers from "./pages/Developers";

function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" }), 50);
      return () => clearTimeout(t);
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function NotFound() {
  return (
    <Page>
      <Window title="Page not found">
        <p className="mt-0">There is no page at this address.</p>
        <Link to="/events" className="btn btn-primary">Go to events</Link>
      </Window>
    </Page>
  );
}

export default function App() {
  const wallets = useMemo(() => [new DemoWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <AuctionsProvider>
          <BrowserRouter>
            <ScrollManager />
            <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-cream focus:p-2">Skip to content</a>
            <div className="flex min-h-screen flex-col">
              <TopBar />
              <div id="content" className="flex-1">
                <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route path="/events" element={<Events />} />
                  <Route path="/events/:address" element={<EventDetail />} />
                  <Route path="/my-orders" element={<MyOrders />} />
                  <Route path="/developers" element={<Developers />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </div>
              <Footer />
            </div>
          </BrowserRouter>
        </AuctionsProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
