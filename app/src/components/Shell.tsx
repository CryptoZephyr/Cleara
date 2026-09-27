import { useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { IconMenu, IconX, Mark } from "./icons";
import { WalletButton } from "./Wallet";
import { CONFIG } from "../../shared/config";
import { explorerAddr } from "../lib/chain";

const NAV = [
  { to: "/events", label: "Events" },
  { to: "/my-orders", label: "My orders" },
  { to: "/#how", label: "How it works" },
  { to: "/#faq", label: "FAQ" },
  { to: "/developers", label: "Developers" },
];

function NavItem({ to, label, onClick }: { to: string; label: string; onClick?: () => void }) {
  const loc = useLocation();
  if (to.includes("#")) {
    return (
      <Link to={to} onClick={onClick} className="flex min-h-[44px] items-center rounded-t-[4px] px-3 text-[14px] font-semibold text-champagne no-underline hover:underline">
        {label}
      </Link>
    );
  }
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex min-h-[44px] items-center rounded-t-[4px] px-3 text-[14px] font-semibold no-underline ${
          isActive || loc.pathname.startsWith(to) ? "bg-cream text-ink" : "text-champagne hover:underline"
        }`
      }
    >
      {label}
    </NavLink>
  );
}

export function DevnetStrip() {
  return (
    <div className="flex h-7 items-center justify-center bg-devnet px-4 label text-cream" role="note">
      <span className="truncate">Synthetic assets · Solana Devnet · No real asset value</span>
    </div>
  );
}

export function TopBar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40">
      <div className="bg-emerald text-champagne">
        <div className="mx-auto flex h-[60px] max-w-[1440px] items-end gap-4 px-8 max-md:h-14 max-md:items-center max-md:px-4">
          <Link to="/" className="mb-2.5 flex items-center gap-2 text-champagne no-underline max-md:mb-0" aria-label="Cleara home">
            <Mark size={28} />
            <span className="text-[19px] font-bold tracking-tight">Cleara</span>
          </Link>
          <nav aria-label="Main" className="ml-6 hidden flex-1 items-end gap-1 md:flex">
            {NAV.map((n) => (
              <NavItem key={n.to} {...n} />
            ))}
          </nav>
          <div className="mb-2 ml-auto flex items-center gap-3 max-md:mb-0">
            <span className="hidden items-center gap-1.5 label xl:flex" title="Connected to Solana Devnet">
              <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-champagne bg-devnet" aria-hidden />
              Devnet
            </span>
            <WalletButton className="max-sm:hidden" />
            <button type="button" className="btn btn-ghost min-w-[44px] px-2 text-champagne md:hidden" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>
              {open ? <IconX size={20} /> : <IconMenu size={20} />}
            </button>
          </div>
        </div>
        {open && (
          <nav id="mobile-nav" aria-label="Main" className="flex flex-col gap-1 border-t border-champagne/30 px-4 pb-4 pt-2 md:hidden">
            {NAV.map((n) => (
              <NavItem key={n.to} {...n} onClick={() => setOpen(false)} />
            ))}
            <WalletButton className="mt-2 sm:hidden" />
          </nav>
        )}
      </div>
      <DevnetStrip />
    </header>
  );
}

export function Footer() {
  return (
    <footer className="bg-emerald text-champagne">
      <div className="mx-auto grid max-w-[1280px] grid-cols-4 gap-8 px-8 py-12 max-lg:grid-cols-2 max-sm:grid-cols-1 max-md:px-4">
        <div>
          <p className="m-0 flex items-center gap-2 text-[19px] font-bold"><Mark size={28} />Cleara</p>
          <p className="mt-3 text-[14px] text-champagne/85">Scheduled liquidity events for thin tokenized assets.</p>
          <span className="inline-block rounded-[3px] bg-devnet px-2 py-0.5 label text-cream">Synthetic assets · Solana Devnet</span>
        </div>
        <FooterCol title="Product" links={[["Events", "/events"], ["How clearing works", "/#how"], ["My orders", "/my-orders"], ["Auction rules", "/developers#rules"]]} />
        <FooterCol title="Developers" links={[["Program and accounts", "/developers"], ["Instructions", "/developers#instructions"], ["Security notes", "/developers#security"]]} external={[["Program on Solana Explorer", explorerAddr(CONFIG.programId)]]} />
        <FooterCol title="Project" links={[["About", "/#about"], ["FAQ", "/#faq"], ["Legal and risk notice", "/developers#risk"]]} external={[["Colosseum", "https://www.colosseum.com"]]} />
      </div>
      <div className="border-t border-champagne/25">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-8 py-5 text-[13px] max-md:px-4">
          <p className="m-0 font-semibold">Hackathon software. Synthetic assets on Solana Devnet. No real asset value.</p>
          <p className="m-0 text-champagne/80">© 2026 Cleara</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links, external = [] }: { title: string; links: [string, string][]; external?: [string, string][] }) {
  return (
    <div>
      <p className="m-0 label text-champagne/75">{title}</p>
      <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0">
        {links.map(([l, to]) => (
          <li key={l}>
            <Link to={to} className="inline-flex min-h-[32px] items-center text-[14px] text-champagne underline-offset-2 hover:underline">{l}</Link>
          </li>
        ))}
        {external.map(([l, href]) => (
          <li key={l}>
            <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-[32px] items-center text-[14px] text-champagne underline-offset-2 hover:underline">{l} ↗</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-[1344px] px-8 py-8 max-md:px-4 max-md:py-6">{children}</main>;
}
