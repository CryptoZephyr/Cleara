# Cleara

**A clear moment to exit.** Scheduled liquidity events for hard-to-sell tokenized assets on Solana.

Live demo (Solana Devnet, synthetic assets): **https://cleara-ten.vercel.app**

> Hackathon prototype for the Colosseum Crypto World's Fair. Devnet only: the assets are synthetic and have no real value.

![Settled event with a single clearing price and per-order receipts](docs/images/settlement.png)

## The problem

Tokenized private-company shares, credit and fund tokens often trade thinly. A holder who wants to sell right away
into a shallow pool can move the price a lot, and buyers who might want the asset aren't in the market at the same moment.

## How Cleara works

An issuer or platform schedules a **liquidity event** for one asset, priced in one quote token.

1. **Collect.** Approved participants place funded buy and sell limit orders until a single deadline. The order book is public.
2. **Clear.** After the deadline, anyone can trigger settlement. The program picks the one price that matches the most volume.
3. **Settle.** Every matched order trades at that price in one all-or-nothing transaction. Unmatched amounts are returned.
   If an event is never settled, anyone can refund each order after the settlement window, subject to the token's transfer rules.

Each event trades one asset. A platform can run any number of events for different assets side by side.

## Try it (about 5 minutes)

1. Open https://cleara-ten.vercel.app and click **Explore events**.
2. Click **Connect wallet** and choose **Cleara demo wallet (Devnet)**. It's a throwaway wallet stored in your browser; no extension or sign-up needed.
3. In **Try it · start your own 4-minute demo event**, pick a synthetic asset and a starting order book, then click **Start demo event**. The server creates an event with demo bots already in the book and adds your wallet to the approved list.
4. Place a buy or sell order. If you're short, **Get demo funds** tops up synthetic tokens. Review the order, then sign.
   Your order appears in the public order book and the provisional clearing price updates.
5. Optionally cancel the order before the deadline and place it again.
6. After the deadline, click **Settle event now**. The receipt shows the clearing price, your fill, what you paid or got, and the Explorer transaction.
7. See **My orders**, the pre-seeded settled, partial-fill and expired events, and the **Developers** page.

| Review before signing | Public order book |
| --- | --- |
| ![Order review](docs/images/order-review.png) | ![Order placed in the public book](docs/images/order-book.png) |

![My orders after settlement](docs/images/my-orders.png)

| Mobile landing | Mobile expired event |
| --- | --- |
| <img src="docs/images/mobile-landing.png" width="300" alt="Mobile landing"> | <img src="docs/images/mobile-expired.png" width="300" alt="Mobile expired event"> |

### Sell now vs join the event

The event page shows a read-only **Jupiter** quote for a comparable mainnet token next to the Devnet event result.
They are labelled separately (`MAINNET QUOTE` and `DEVNET EVENT`). A quote isn't guaranteed liquidity, and synthetic
Devnet assets don't inherit real market depth.

## Devnet deployment

| Item | Address |
| --- | --- |
| Program | [`AnVHa4HHZHhUTepWnSGwxDLUEmkKyAuD6sHeKPtTSY6W`](https://explorer.solana.com/address/AnVHa4HHZHhUTepWnSGwxDLUEmkKyAuD6sHeKPtTSY6W?cluster=devnet) |
| Upgrade authority | `6zucjHBkFGvYrMckh3eamw9Bq5KmAWRLVJvqXSYG4nMp` |
| Quote mint (dUSDC, synthetic) | `Fk454Hd66rMQ2kRtNsCRF3m6XKZgGy8d8RWPvvVaDrCX` |
| NRTH, Northwind Robotics (synthetic) | `HFHZDubMuKFJ1Q1WEtF7GoxNjgA2WfsnXErfVdhMmUiC` |
| HLCN, Halcyon Solar Credit Note (synthetic) | `Cp12dQeWgNRuUbDXHnkW1rRx5DeCrN2ykr3epiXtNda7` |
| ORCH, Orchard Lane Residences (synthetic) | `GR9xzAkoqQ9YcAqGbqEBNYwoCkcuQ4F7LyJsKUEvpnBP` |

## Repository layout

```
programs/cleara/        Anchor program (lib.rs: instructions and accounts, clearing.rs: clearing algorithm)
tests/cleara.ts         Integration tests against a local validator
app/                    Web app (Vite, React 19, TypeScript, Tailwind 4, wallet adapter)
  src/                  Pages, components, chain client (lib/chain.ts), demo wallet
  shared/               Bigint clearing mirror of the program, config, demo scenarios
  server/               Demo operator logic and the /api/demo handler (server-side signing)
  api/demo.js           Generated Vercel function (npm run build:api); do not edit
  scripts/              One-time Devnet setup and event seeding
docs/images/            README screenshots
```

## Run the web app locally

Requires Node 22.

```bash
cd app
npm install
npm run dev          # http://localhost:5173, reads Devnet directly
```

`npm run dev` serves the UI only. The demo wallet funding and "start your own event" buttons call `/api/demo`, which
runs as a Vercel function; use `npx vercel dev` to serve it locally.

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_RPC_URL` | browser, optional | Solana RPC (default `https://api.devnet.solana.com`) |
| `RPC_URL` | server and scripts, optional | Solana RPC for the operator |
| `CLEARA_OPERATOR_SECRET` | server only | Operator keypair that funds demo wallets and creates demo events. Never expose it to the browser. |

Checks: `npm run typecheck`, `npm run lint`, `npm run build`. After changing `server/`, run `npm run build:api`
and commit the regenerated `api/demo.js`.

The Devnet setup scripts (`scripts/setup-devnet.ts`, `scripts/seed-events.ts`) read keypairs from
`~/.config/solana/cleara-owner.json` and `~/.config/solana/cleara-operator.json`, which are never committed. Run them with `npx tsx`.

### Demo API

`POST /api/demo` with a JSON body:

- `{ "action": "fund", "wallet": "<pubkey>", "asset": "<base mint>", "base": "<atoms>", "quote": "<atoms>" }` tops up
  synthetic tokens and a little SOL, up to fixed caps.
- `{ "action": "event", "wallet": "<pubkey>", "asset": "<base mint>", "scenario": "crossing" | "partial" | "no-overlap" }`
  creates a 4-minute event with bot orders and puts the wallet on the roster.

The operator refuses requests once its balance falls below 0.5 SOL. There's no per-caller rate limit yet.

## What the program guarantees

- Everyone matched trades at the **same price**.
- Settlement is **atomic**: every transfer succeeds or none do.
- Unmatched funds and tokens are returned; after `settle_by`, **anyone** can refund any single order.
- Vault balances are checked against escrowed orders before settlement and must be exactly zero after it.

## What it does not guarantee

- A "fair" price: the price is whatever the participating orders produce.
- Hidden orders: the book is stored in plain account data and readable by anyone over RPC. Late bidding is possible.
- Buyers: an auction cannot create demand.
- Refunds through issuer controls: if the issuer freezes an account or vault, transfers to/from it fail. Refunds are
  per order so one blocked account does not block the others.

## Clearing rules

| Rule | Implementation |
| --- | --- |
| Order book | Fixed array of 8 slots inside the `Auction` account (canonical membership, no external order accounts) |
| Participants | Issuer-supplied roster (max 8) with a per-participant active-order allowance |
| Minimum size | `min_base_qty` per order |
| Self-trade | A participant cannot hold orders on both sides |
| Deadline | One deadline for placing and cancelling; cancelled slots can be reused before it |
| Clearing price | Candidate prices = all limit prices; pick max matched volume, ties go to the lowest price |
| Allocation | Price priority; pro-rata inside the marginal price level; leftover atoms one each to lowest slot index |
| Rounding | Buyers pay `ceil(fill * price)`, sellers receive `floor(fill * price)`; the difference goes to the fee account |
| Fee | `fee_bps` on seller proceeds (max 10%) |
| Settlement | `settle` between `deadline` and `settle_by`; `remaining_accounts` = [base, quote] token account per non-empty slot, in slot order, owner and mint checked |
| Expiry | After `settle_by`, `refund_expired(slot)` is permissionless |
| Tokens | Base and quote can be SPL Token or Token-2022. Token-2022 mints may only use `MetadataPointer` / `TokenMetadata` (no transfer fees, hooks, scaled amounts, etc.) |

Prices are quote atoms per one whole base token.

## Settlement benchmark (localnet, agave 4.2.2)

8-order settlement (4 sellers, 4 buyers, Token-2022 base, SPL quote): **1009 bytes, ~69k CU**, which fits in a legacy
1232-byte transaction. Solana's 4096-byte transactions (v1) leave headroom for a larger book or transfer-hook accounts;
that has not been benchmarked yet.

## Program tests

Rust unit tests (`clearing.rs`): full cross, no overlap, price priority, pro-rata remainder, exhaustive conservation
check over small books.

TypeScript integration tests (`tests/cleara.ts`):

1. Overlapping orders clear at one price (balances, fees, empty vaults, no double settlement)
2. Not enough buyers: partial fill plus refund
3. No overlap: nothing trades, everyone refunded
4. Never settled: settlement rejected after expiry, anyone can refund
5. Guards: roster, allowance, self-trade, minimum size, cancel/reuse, deadlines
6. Settlement rejects missing, reordered or substituted token accounts
7. A frozen account blocks atomic settlement, and other orders can still be refunded
8. Token-2022 mint with a transfer fee is rejected
9. 8-order capacity benchmark

## Build and test the program

Requires Anchor 0.32.1, a Rust 1.89 host toolchain for the IDL build, Agave 4.x (`cargo-build-sbf` with platform-tools v1.54), Node 22, Yarn.

```bash
yarn install
cargo test --manifest-path programs/cleara/Cargo.toml
cargo-build-sbf --manifest-path programs/cleara/Cargo.toml --sbf-out-dir target/deploy
RUSTUP_TOOLCHAIN=1.89.0 anchor idl build -o target/idl/cleara.json -t target/types/cleara.ts
solana-test-validator --reset --bpf-program AnVHa4HHZHhUTepWnSGwxDLUEmkKyAuD6sHeKPtTSY6W target/deploy/cleara.so
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
```

## Legal

Checking who may hold a token is not permission to operate a securities market. A production launch requires a
licensed partner and legal review. This repository is a technical prototype only.
