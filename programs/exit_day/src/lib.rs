use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions},
};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

pub mod clearing;

declare_id!("AnVHa4HHZHhUTepWnSGwxDLUEmkKyAuD6sHeKPtTSY6W");

pub const MAX_ORDERS: usize = 8;
pub const MAX_ROSTER: usize = 8;
pub const MAX_FEE_BPS: u16 = 1_000;

pub const SIDE_EMPTY: u8 = 0;
pub const SIDE_BUY: u8 = 1;
pub const SIDE_SELL: u8 = 2;

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_SETTLED: u8 = 1;

pub const AUCTION_SEED: &[u8] = b"auction";
pub const BASE_VAULT_SEED: &[u8] = b"base_vault";
pub const QUOTE_VAULT_SEED: &[u8] = b"quote_vault";

const ALLOWED_MINT_EXTENSIONS: &[ExtensionType] =
    &[ExtensionType::MetadataPointer, ExtensionType::TokenMetadata];

#[program]
pub mod exit_day {
    use super::*;

    pub fn create_auction(
        ctx: Context<CreateAuction>,
        auction_id: u64,
        deadline: i64,
        settle_by: i64,
        min_base_qty: u64,
        fee_bps: u16,
        roster: Vec<RosterInput>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(deadline > now, ExitDayError::BadSchedule);
        require!(settle_by > deadline, ExitDayError::BadSchedule);
        require!(fee_bps <= MAX_FEE_BPS, ExitDayError::FeeTooHigh);
        require!(min_base_qty > 0, ExitDayError::OrderTooSmall);
        require!(
            !roster.is_empty() && roster.len() <= MAX_ROSTER,
            ExitDayError::BadRoster
        );
        require_keys_neq!(
            ctx.accounts.base_mint.key(),
            ctx.accounts.quote_mint.key(),
            ExitDayError::SameMint
        );
        check_mint_extensions(&ctx.accounts.base_mint.to_account_info())?;
        check_mint_extensions(&ctx.accounts.quote_mint.to_account_info())?;

        let a = &mut ctx.accounts.auction;
        a.issuer = ctx.accounts.issuer.key();
        a.auction_id = auction_id;
        a.base_mint = ctx.accounts.base_mint.key();
        a.quote_mint = ctx.accounts.quote_mint.key();
        a.base_decimals = ctx.accounts.base_mint.decimals;
        a.quote_decimals = ctx.accounts.quote_mint.decimals;
        a.fee_account = ctx.accounts.fee_account.key();
        a.deadline = deadline;
        a.settle_by = settle_by;
        a.min_base_qty = min_base_qty;
        a.fee_bps = fee_bps;
        a.status = STATUS_OPEN;
        a.bump = ctx.bumps.auction;
        a.base_vault_bump = ctx.bumps.base_vault;
        a.quote_vault_bump = ctx.bumps.quote_vault;
        a.clearing_price = 0;
        a.cleared_volume = 0;
        for (i, r) in roster.iter().enumerate() {
            require!(
                r.allowance > 0 && r.allowance as usize <= MAX_ORDERS,
                ExitDayError::BadRoster
            );
            require!(
                !roster[..i].iter().any(|p| p.participant == r.participant),
                ExitDayError::BadRoster
            );
            a.roster[i] = RosterEntry {
                participant: r.participant,
                allowance: r.allowance,
                active: 0,
            };
        }
        a.roster_len = roster.len() as u8;
        Ok(())
    }

    pub fn place_order(
        ctx: Context<PlaceOrder>,
        side: u8,
        limit_price: u64,
        qty: u64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &mut ctx.accounts.auction;
        require!(a.status == STATUS_OPEN, ExitDayError::NotOpen);
        require!(now < a.deadline, ExitDayError::PastDeadline);
        require!(side == SIDE_BUY || side == SIDE_SELL, ExitDayError::BadSide);
        require!(limit_price > 0, ExitDayError::BadPrice);
        require!(qty >= a.min_base_qty, ExitDayError::OrderTooSmall);

        let owner = ctx.accounts.owner.key();
        let r = a.roster_index(&owner).ok_or(ExitDayError::NotOnRoster)?;
        require!(
            a.roster[r].active < a.roster[r].allowance,
            ExitDayError::AllowanceUsed
        );
        let opposite = if side == SIDE_BUY {
            SIDE_SELL
        } else {
            SIDE_BUY
        };
        require!(
            !a.orders
                .iter()
                .any(|o| o.side == opposite && o.owner == owner),
            ExitDayError::SelfTrade
        );
        let slot = a
            .orders
            .iter()
            .position(|o| o.side == SIDE_EMPTY)
            .ok_or(ExitDayError::BookFull)?;

        let escrowed = if side == SIDE_SELL {
            qty
        } else {
            quote_ceil(qty, limit_price, a.base_decimals)?
        };
        require!(escrowed > 0, ExitDayError::OrderTooSmall);

        a.orders[slot] = Order {
            owner,
            side,
            limit_price,
            qty,
            escrowed,
            filled: 0,
        };
        a.roster[r].active += 1;

        if side == SIDE_SELL {
            transfer(
                &ctx.accounts.base_token_program,
                &ctx.accounts.owner_base,
                &ctx.accounts.base_mint,
                &ctx.accounts.base_vault.to_account_info(),
                &ctx.accounts.owner.to_account_info(),
                escrowed,
                None,
            )?;
        } else {
            transfer(
                &ctx.accounts.quote_token_program,
                &ctx.accounts.owner_quote,
                &ctx.accounts.quote_mint,
                &ctx.accounts.quote_vault.to_account_info(),
                &ctx.accounts.owner.to_account_info(),
                escrowed,
                None,
            )?;
        }
        emit!(OrderPlaced {
            auction: ctx.accounts.auction.key(),
            slot: slot as u8,
            owner,
            side,
            limit_price,
            qty
        });
        Ok(())
    }

    pub fn cancel_order(ctx: Context<CancelOrder>, slot: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let auction_key = ctx.accounts.auction.key();
        let a = &mut ctx.accounts.auction;
        require!(a.status == STATUS_OPEN, ExitDayError::NotOpen);
        require!(now < a.deadline, ExitDayError::PastDeadline);
        let s = slot as usize;
        require!(
            s < MAX_ORDERS && a.orders[s].side != SIDE_EMPTY,
            ExitDayError::EmptySlot
        );
        let owner = ctx.accounts.owner.key();
        require_keys_eq!(a.orders[s].owner, owner, ExitDayError::NotOrderOwner);
        let order = a.orders[s];
        a.orders[s] = Order::default();
        let r = a.roster_index(&owner).ok_or(ExitDayError::NotOnRoster)?;
        a.roster[r].active -= 1;

        let (issuer, id, bump) = (a.issuer, a.auction_id, a.bump);
        let id_bytes = id.to_le_bytes();
        let seeds: &[&[u8]] = &[AUCTION_SEED, issuer.as_ref(), &id_bytes, &[bump]];
        let auth = ctx.accounts.auction.to_account_info();
        if order.side == SIDE_SELL {
            transfer(
                &ctx.accounts.base_token_program,
                &ctx.accounts.base_vault,
                &ctx.accounts.base_mint,
                &ctx.accounts.owner_base.to_account_info(),
                &auth,
                order.escrowed,
                Some(&[seeds]),
            )?;
        } else {
            transfer(
                &ctx.accounts.quote_token_program,
                &ctx.accounts.quote_vault,
                &ctx.accounts.quote_mint,
                &ctx.accounts.owner_quote.to_account_info(),
                &auth,
                order.escrowed,
                Some(&[seeds]),
            )?;
        }
        emit!(OrderCancelled {
            auction: auction_key,
            slot
        });
        Ok(())
    }

    /// Clears and settles every order in one instruction. `remaining_accounts` must be,
    /// for each non-empty slot in ascending order: [owner base account, owner quote account].
    pub fn settle<'info>(ctx: Context<'_, '_, 'info, 'info, Settle<'info>>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let auction_key = ctx.accounts.auction.key();
        let (orders, base_decimals, fee_bps, issuer, id, bump) = {
            let a = &ctx.accounts.auction;
            require!(a.status == STATUS_OPEN, ExitDayError::NotOpen);
            require!(now >= a.deadline, ExitDayError::BeforeDeadline);
            require!(now <= a.settle_by, ExitDayError::SettlementExpired);
            (
                a.orders,
                a.base_decimals,
                a.fee_bps,
                a.issuer,
                a.auction_id,
                a.bump,
            )
        };

        let active: Vec<usize> = (0..MAX_ORDERS)
            .filter(|&i| orders[i].side != SIDE_EMPTY)
            .collect();
        let rem = ctx.remaining_accounts;
        require!(rem.len() == active.len() * 2, ExitDayError::WrongAccounts);

        let total_quote: u64 = orders
            .iter()
            .filter(|o| o.side == SIDE_BUY)
            .map(|o| o.escrowed)
            .sum();
        let total_base: u64 = orders
            .iter()
            .filter(|o| o.side == SIDE_SELL)
            .map(|o| o.escrowed)
            .sum();
        require!(
            ctx.accounts.quote_vault.amount == total_quote,
            ExitDayError::VaultMismatch
        );
        require!(
            ctx.accounts.base_vault.amount == total_base,
            ExitDayError::VaultMismatch
        );

        let c = clearing::clear(&orders);

        let id_bytes = id.to_le_bytes();
        let seeds: &[&[u8]] = &[AUCTION_SEED, issuer.as_ref(), &id_bytes, &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        let auth = ctx.accounts.auction.to_account_info();

        let mut paid_by_buyers: u64 = 0;
        let mut gross_to_sellers: u64 = 0;
        let mut fees: u64 = 0;

        for (n, &i) in active.iter().enumerate() {
            let o = orders[i];
            let base_ai = &rem[2 * n];
            let quote_ai = &rem[2 * n + 1];
            check_owner_account(base_ai, &o.owner, &ctx.accounts.base_mint.key())?;
            check_owner_account(quote_ai, &o.owner, &ctx.accounts.quote_mint.key())?;
            let fill = c.fills[i];

            let (base_out, quote_out) = if o.side == SIDE_BUY {
                let pay = if fill > 0 {
                    quote_ceil(fill, c.price, base_decimals)?
                } else {
                    0
                };
                require!(pay <= o.escrowed, ExitDayError::MathError);
                paid_by_buyers += pay;
                (fill, o.escrowed - pay)
            } else {
                let gross = quote_floor(fill, c.price, base_decimals)?;
                let fee = (gross as u128 * fee_bps as u128 / 10_000) as u64;
                gross_to_sellers += gross;
                fees += fee;
                (o.escrowed - fill, gross - fee)
            };

            if base_out > 0 {
                transfer(
                    &ctx.accounts.base_token_program,
                    &ctx.accounts.base_vault,
                    &ctx.accounts.base_mint,
                    base_ai,
                    &auth,
                    base_out,
                    Some(signer),
                )?;
            }
            if quote_out > 0 {
                transfer(
                    &ctx.accounts.quote_token_program,
                    &ctx.accounts.quote_vault,
                    &ctx.accounts.quote_mint,
                    quote_ai,
                    &auth,
                    quote_out,
                    Some(signer),
                )?;
            }
        }

        require!(paid_by_buyers >= gross_to_sellers, ExitDayError::MathError);
        let to_fee = fees + (paid_by_buyers - gross_to_sellers);
        if to_fee > 0 {
            transfer(
                &ctx.accounts.quote_token_program,
                &ctx.accounts.quote_vault,
                &ctx.accounts.quote_mint,
                &ctx.accounts.fee_account.to_account_info(),
                &auth,
                to_fee,
                Some(signer),
            )?;
        }

        ctx.accounts.base_vault.reload()?;
        ctx.accounts.quote_vault.reload()?;
        require!(
            ctx.accounts.base_vault.amount == 0,
            ExitDayError::VaultMismatch
        );
        require!(
            ctx.accounts.quote_vault.amount == 0,
            ExitDayError::VaultMismatch
        );

        let a = &mut ctx.accounts.auction;
        for &i in active.iter() {
            a.orders[i].filled = c.fills[i];
        }
        a.clearing_price = c.price;
        a.cleared_volume = c.volume;
        a.status = STATUS_SETTLED;
        emit!(AuctionSettled {
            auction: auction_key,
            price: c.price,
            volume: c.volume,
            fees: to_fee
        });
        Ok(())
    }

    /// After `settle_by`, anyone can return one unsettled order's escrow to its owner.
    /// Per-order so that one frozen or restricted account cannot block everyone else.
    pub fn refund_expired(ctx: Context<RefundExpired>, slot: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let auction_key = ctx.accounts.auction.key();
        let a = &mut ctx.accounts.auction;
        require!(a.status == STATUS_OPEN, ExitDayError::NotOpen);
        require!(now > a.settle_by, ExitDayError::NotExpired);
        let s = slot as usize;
        require!(
            s < MAX_ORDERS && a.orders[s].side != SIDE_EMPTY,
            ExitDayError::EmptySlot
        );
        let order = a.orders[s];
        a.orders[s] = Order::default();
        if let Some(r) = a.roster_index(&order.owner) {
            a.roster[r].active -= 1;
        }
        let (issuer, id, bump) = (a.issuer, a.auction_id, a.bump);
        let id_bytes = id.to_le_bytes();
        let seeds: &[&[u8]] = &[AUCTION_SEED, issuer.as_ref(), &id_bytes, &[bump]];
        let auth = ctx.accounts.auction.to_account_info();
        if order.side == SIDE_SELL {
            require_keys_eq!(
                ctx.accounts.owner_base.owner,
                order.owner,
                ExitDayError::WrongAccounts
            );
            transfer(
                &ctx.accounts.base_token_program,
                &ctx.accounts.base_vault,
                &ctx.accounts.base_mint,
                &ctx.accounts.owner_base.to_account_info(),
                &auth,
                order.escrowed,
                Some(&[seeds]),
            )?;
        } else {
            require_keys_eq!(
                ctx.accounts.owner_quote.owner,
                order.owner,
                ExitDayError::WrongAccounts
            );
            transfer(
                &ctx.accounts.quote_token_program,
                &ctx.accounts.quote_vault,
                &ctx.accounts.quote_mint,
                &ctx.accounts.owner_quote.to_account_info(),
                &auth,
                order.escrowed,
                Some(&[seeds]),
            )?;
        }
        emit!(OrderRefunded {
            auction: auction_key,
            slot
        });
        Ok(())
    }
}

fn scale(decimals: u8) -> u128 {
    10u128.pow(decimals as u32)
}

/// Quote atoms for `qty` base atoms at `price` quote atoms per whole base token, rounded up.
pub fn quote_ceil(qty: u64, price: u64, base_decimals: u8) -> Result<u64> {
    let n = qty as u128 * price as u128;
    let s = scale(base_decimals);
    u64::try_from(n.div_ceil(s)).map_err(|_| error!(ExitDayError::MathError))
}

pub fn quote_floor(qty: u64, price: u64, base_decimals: u8) -> Result<u64> {
    let n = qty as u128 * price as u128;
    u64::try_from(n / scale(base_decimals)).map_err(|_| error!(ExitDayError::MathError))
}

fn check_mint_extensions(mint: &AccountInfo) -> Result<()> {
    if *mint.owner != spl_token_2022::ID {
        return Ok(());
    }
    let data = mint.try_borrow_data()?;
    let state = StateWithExtensions::<spl_token_2022::state::Mint>::unpack(&data)?;
    for ext in state.get_extension_types()? {
        require!(
            ALLOWED_MINT_EXTENSIONS.contains(&ext),
            ExitDayError::UnsupportedExtension
        );
    }
    Ok(())
}

fn check_owner_account<'a>(ai: &'a AccountInfo<'a>, owner: &Pubkey, mint: &Pubkey) -> Result<()> {
    require!(ai.is_writable, ExitDayError::WrongAccounts);
    let ta = InterfaceAccount::<TokenAccount>::try_from(ai)
        .map_err(|_| error!(ExitDayError::WrongAccounts))?;
    require_keys_eq!(ta.owner, *owner, ExitDayError::WrongAccounts);
    require_keys_eq!(ta.mint, *mint, ExitDayError::WrongAccounts);
    Ok(())
}

fn transfer<'info>(
    program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    signer: Option<&[&[&[u8]]]>,
) -> Result<()> {
    let accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.clone(),
        authority: authority.clone(),
    };
    let cpi = match signer {
        Some(s) => CpiContext::new_with_signer(program.to_account_info(), accounts, s),
        None => CpiContext::new(program.to_account_info(), accounts),
    };
    token_interface::transfer_checked(cpi, amount, mint.decimals)
}

#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug, PartialEq, Eq, InitSpace,
)]
pub struct Order {
    pub owner: Pubkey,
    pub side: u8,
    /// Quote atoms per one whole base token.
    pub limit_price: u64,
    /// Base atoms.
    pub qty: u64,
    /// Base atoms (sell) or quote atoms (buy) held in the vault for this order.
    pub escrowed: u64,
    pub filled: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug, InitSpace)]
pub struct RosterEntry {
    pub participant: Pubkey,
    pub allowance: u8,
    pub active: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct RosterInput {
    pub participant: Pubkey,
    pub allowance: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Auction {
    pub issuer: Pubkey,
    pub auction_id: u64,
    pub base_mint: Pubkey,
    pub quote_mint: Pubkey,
    pub base_decimals: u8,
    pub quote_decimals: u8,
    pub fee_account: Pubkey,
    pub deadline: i64,
    pub settle_by: i64,
    pub min_base_qty: u64,
    pub fee_bps: u16,
    pub status: u8,
    pub bump: u8,
    pub base_vault_bump: u8,
    pub quote_vault_bump: u8,
    pub clearing_price: u64,
    pub cleared_volume: u64,
    pub orders: [Order; MAX_ORDERS],
    pub roster: [RosterEntry; MAX_ROSTER],
    pub roster_len: u8,
}

impl Auction {
    pub fn roster_index(&self, who: &Pubkey) -> Option<usize> {
        self.roster[..self.roster_len as usize]
            .iter()
            .position(|r| r.participant == *who)
    }
}

#[derive(Accounts)]
#[instruction(auction_id: u64)]
pub struct CreateAuction<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(
        init,
        payer = issuer,
        space = 8 + Auction::INIT_SPACE,
        seeds = [AUCTION_SEED, issuer.key().as_ref(), &auction_id.to_le_bytes()],
        bump
    )]
    pub auction: Box<Account<'info, Auction>>,
    #[account(mint::token_program = base_token_program)]
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mint::token_program = quote_token_program)]
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = issuer,
        seeds = [BASE_VAULT_SEED, auction.key().as_ref()],
        bump,
        token::mint = base_mint,
        token::authority = auction,
        token::token_program = base_token_program
    )]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = issuer,
        seeds = [QUOTE_VAULT_SEED, auction.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = auction,
        token::token_program = quote_token_program
    )]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(token::mint = quote_mint, token::token_program = quote_token_program)]
    pub fee_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceOrder<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = base_mint, has_one = quote_mint)]
    pub auction: Box<Account<'info, Auction>>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::authority = owner, token::token_program = base_token_program)]
    pub owner_base: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = owner, token::token_program = quote_token_program)]
    pub owner_quote: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [BASE_VAULT_SEED, auction.key().as_ref()], bump = auction.base_vault_bump)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [QUOTE_VAULT_SEED, auction.key().as_ref()], bump = auction.quote_vault_bump)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = base_mint, has_one = quote_mint)]
    pub auction: Box<Account<'info, Auction>>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::authority = owner, token::token_program = base_token_program)]
    pub owner_base: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = owner, token::token_program = quote_token_program)]
    pub owner_quote: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [BASE_VAULT_SEED, auction.key().as_ref()], bump = auction.base_vault_bump)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [QUOTE_VAULT_SEED, auction.key().as_ref()], bump = auction.quote_vault_bump)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut, has_one = base_mint, has_one = quote_mint, has_one = fee_account)]
    pub auction: Box<Account<'info, Auction>>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [BASE_VAULT_SEED, auction.key().as_ref()], bump = auction.base_vault_bump)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [QUOTE_VAULT_SEED, auction.key().as_ref()], bump = auction.quote_vault_bump)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub fee_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = base_mint.to_account_info().owner.key())]
    pub base_token_program: Interface<'info, TokenInterface>,
    #[account(address = quote_mint.to_account_info().owner.key())]
    pub quote_token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RefundExpired<'info> {
    #[account(mut, has_one = base_mint, has_one = quote_mint)]
    pub auction: Box<Account<'info, Auction>>,
    pub base_mint: Box<InterfaceAccount<'info, Mint>>,
    pub quote_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = base_mint, token::token_program = base_token_program)]
    pub owner_base: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::token_program = quote_token_program)]
    pub owner_quote: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [BASE_VAULT_SEED, auction.key().as_ref()], bump = auction.base_vault_bump)]
    pub base_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [QUOTE_VAULT_SEED, auction.key().as_ref()], bump = auction.quote_vault_bump)]
    pub quote_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub base_token_program: Interface<'info, TokenInterface>,
    pub quote_token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct OrderPlaced {
    pub auction: Pubkey,
    pub slot: u8,
    pub owner: Pubkey,
    pub side: u8,
    pub limit_price: u64,
    pub qty: u64,
}

#[event]
pub struct OrderCancelled {
    pub auction: Pubkey,
    pub slot: u8,
}

#[event]
pub struct OrderRefunded {
    pub auction: Pubkey,
    pub slot: u8,
}

#[event]
pub struct AuctionSettled {
    pub auction: Pubkey,
    pub price: u64,
    pub volume: u64,
    pub fees: u64,
}

#[error_code]
pub enum ExitDayError {
    #[msg("Deadline must be in the future and settle_by after the deadline")]
    BadSchedule,
    #[msg("Fee exceeds maximum")]
    FeeTooHigh,
    #[msg("Roster is empty, too long, has duplicates or invalid allowances")]
    BadRoster,
    #[msg("Base and quote mint must differ")]
    SameMint,
    #[msg("Mint uses an unsupported Token-2022 extension")]
    UnsupportedExtension,
    #[msg("Auction is not open")]
    NotOpen,
    #[msg("Order window has closed")]
    PastDeadline,
    #[msg("Order window has not closed yet")]
    BeforeDeadline,
    #[msg("Settlement window has passed; use refund_expired")]
    SettlementExpired,
    #[msg("Settlement window has not passed yet")]
    NotExpired,
    #[msg("Side must be buy (1) or sell (2)")]
    BadSide,
    #[msg("Price must be positive")]
    BadPrice,
    #[msg("Order below minimum size")]
    OrderTooSmall,
    #[msg("Signer is not on the approved roster")]
    NotOnRoster,
    #[msg("Participant has used all order slots")]
    AllowanceUsed,
    #[msg("Participant already has an order on the other side")]
    SelfTrade,
    #[msg("All order slots are taken")]
    BookFull,
    #[msg("Slot is empty")]
    EmptySlot,
    #[msg("Signer does not own this order")]
    NotOrderOwner,
    #[msg("Settlement accounts are missing, extra, out of order or mismatched")]
    WrongAccounts,
    #[msg("Vault balance does not match escrowed orders")]
    VaultMismatch,
    #[msg("Arithmetic error")]
    MathError,
}
