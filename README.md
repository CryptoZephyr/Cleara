# Exit Day

Scheduled liquidity events for thinly traded tokenized assets on Solana.

An issuer schedules one auction for one asset. Approved participants place buy and sell limit orders until a single
deadline. After the deadline, anyone can trigger settlement: the program computes one clearing price that maximises
matched volume and settles every order in a single, all-or-nothing transaction. Unmatched amounts are returned,
subject to the asset's own transfer rules.

> Prototype for the Colosseum hackathon. Devnet/localnet and synthetic tokens only. All test orders are fake.

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

## Mechanism

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

## Benchmark (localnet, agave 4.2.2)

8-order settlement (4 sellers, 4 buyers, Token-2022 base, SPL quote): **1009 bytes, ~69k CU**, which fits in a legacy
1232-byte transaction. Solana's 4096-byte transactions (v1) leave headroom for a larger book or transfer-hook accounts;
that has not been benchmarked yet.

## Tests

Rust unit tests (`clearing.rs`): full cross, no overlap, price priority, pro-rata remainder, exhaustive conservation
check over small books.

TypeScript integration tests (`tests/exit_day.ts`):

1. Overlapping orders clear at one price (balances, fees, empty vaults, no double settlement)
2. Not enough buyers: partial fill plus refund
3. No overlap: nothing trades, everyone refunded
4. Never settled: settlement rejected after expiry, anyone can refund
5. Guards: roster, allowance, self-trade, minimum size, cancel/reuse, deadlines
6. Settlement rejects missing, reordered or substituted token accounts
7. A frozen account blocks atomic settlement, and other orders can still be refunded
8. Token-2022 mint with a transfer fee is rejected
9. 8-order capacity benchmark

## Build and test

Requires Anchor 0.32.1, Agave 4.x (`cargo-build-sbf` with platform-tools v1.54), Node 22, Yarn.

```bash
yarn install
cargo test --manifest-path programs/exit_day/Cargo.toml
cargo-build-sbf --manifest-path programs/exit_day/Cargo.toml --sbf-out-dir target/deploy
anchor idl build -o target/idl/exit_day.json -t target/types/exit_day.ts
solana-test-validator --reset --bpf-program AnVHa4HHZHhUTepWnSGwxDLUEmkKyAuD6sHeKPtTSY6W target/deploy/exit_day.so
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
```

## Legal

Checking who may hold a token is not permission to operate a securities market. A production launch requires a
licensed partner and legal review. This repository is a technical prototype only.
