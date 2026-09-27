use crate::{Order, MAX_ORDERS, SIDE_BUY, SIDE_EMPTY, SIDE_SELL};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Clearing {
    pub price: u64,
    pub volume: u64,
    pub fills: [u64; MAX_ORDERS],
}

fn eligible(o: &Order, price: u64) -> bool {
    match o.side {
        SIDE_BUY => o.limit_price >= price,
        SIDE_SELL => o.limit_price <= price,
        _ => false,
    }
}

/// Picks the price that maximises matched base volume (ties: lowest price),
/// then allocates by price priority, pro-rata within the marginal level,
/// with leftover atoms assigned one each to the lowest slot indices.
pub fn clear(orders: &[Order; MAX_ORDERS]) -> Clearing {
    let mut best = Clearing {
        price: 0,
        volume: 0,
        fills: [0; MAX_ORDERS],
    };
    for cand in orders.iter().filter(|o| o.side != SIDE_EMPTY) {
        let p = cand.limit_price;
        let mut demand: u128 = 0;
        let mut supply: u128 = 0;
        for o in orders.iter().filter(|o| eligible(o, p)) {
            if o.side == SIDE_BUY {
                demand += o.qty as u128;
            } else {
                supply += o.qty as u128;
            }
        }
        let v = demand.min(supply) as u64;
        if v > best.volume || (v == best.volume && v > 0 && p < best.price) {
            best.price = p;
            best.volume = v;
        }
    }
    if best.volume == 0 {
        return Clearing {
            price: 0,
            volume: 0,
            fills: [0; MAX_ORDERS],
        };
    }
    allocate(orders, SIDE_BUY, best.price, best.volume, &mut best.fills);
    allocate(orders, SIDE_SELL, best.price, best.volume, &mut best.fills);
    best
}

fn allocate(
    orders: &[Order; MAX_ORDERS],
    side: u8,
    price: u64,
    volume: u64,
    fills: &mut [u64; MAX_ORDERS],
) {
    let mut idx: Vec<usize> = (0..MAX_ORDERS)
        .filter(|&i| orders[i].side == side && eligible(&orders[i], price))
        .collect();
    idx.sort_by(|&a, &b| {
        let (pa, pb) = (orders[a].limit_price, orders[b].limit_price);
        let by_price = if side == SIDE_BUY {
            pb.cmp(&pa)
        } else {
            pa.cmp(&pb)
        };
        by_price.then(a.cmp(&b))
    });
    let mut remaining = volume;
    let mut i = 0;
    while i < idx.len() && remaining > 0 {
        let level_price = orders[idx[i]].limit_price;
        let mut j = i;
        while j < idx.len() && orders[idx[j]].limit_price == level_price {
            j += 1;
        }
        let level = &idx[i..j];
        let level_qty: u64 = level.iter().map(|&k| orders[k].qty).sum();
        if level_qty <= remaining {
            for &k in level {
                fills[k] = orders[k].qty;
            }
            remaining -= level_qty;
        } else {
            let mut given = 0u64;
            for &k in level {
                let f = ((orders[k].qty as u128 * remaining as u128) / level_qty as u128) as u64;
                fills[k] = f;
                given += f;
            }
            let mut left = remaining - given;
            let mut by_slot: Vec<usize> = level.to_vec();
            by_slot.sort();
            for &k in by_slot.iter() {
                if left == 0 {
                    break;
                }
                if fills[k] < orders[k].qty {
                    fills[k] += 1;
                    left -= 1;
                }
            }
            remaining = 0;
        }
        i = j;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    fn o(side: u8, price: u64, qty: u64) -> Order {
        Order {
            owner: Pubkey::default(),
            side,
            limit_price: price,
            qty,
            escrowed: 0,
            filled: 0,
        }
    }
    fn book(v: &[Order]) -> [Order; MAX_ORDERS] {
        let mut b = [Order::default(); MAX_ORDERS];
        b[..v.len()].copy_from_slice(v);
        b
    }

    #[test]
    fn full_cross() {
        let b = book(&[o(SIDE_SELL, 90, 100), o(SIDE_BUY, 100, 100)]);
        let c = clear(&b);
        assert_eq!((c.price, c.volume), (90, 100));
        assert_eq!(&c.fills[..2], &[100, 100]);
    }

    #[test]
    fn no_overlap() {
        let b = book(&[o(SIDE_SELL, 110, 100), o(SIDE_BUY, 100, 100)]);
        assert_eq!(clear(&b).volume, 0);
    }

    #[test]
    fn partial_price_priority() {
        let b = book(&[
            o(SIDE_SELL, 80, 60),
            o(SIDE_SELL, 95, 60),
            o(SIDE_BUY, 100, 50),
            o(SIDE_BUY, 96, 30),
        ]);
        let c = clear(&b);
        assert_eq!(c.volume, 80);
        assert_eq!(c.price, 95);
        assert_eq!(&c.fills[..4], &[60, 20, 50, 30]);
    }

    #[test]
    fn pro_rata_with_remainder() {
        let b = book(&[
            o(SIDE_SELL, 50, 10),
            o(SIDE_BUY, 60, 7),
            o(SIDE_BUY, 60, 7),
            o(SIDE_BUY, 60, 7),
        ]);
        let c = clear(&b);
        assert_eq!(c.volume, 10);
        assert_eq!(&c.fills[1..4], &[4, 3, 3]);
        assert_eq!(c.fills[1..4].iter().sum::<u64>(), 10);
    }

    #[test]
    fn conservation_exhaustive_small() {
        let prices = [1u64, 5, 9];
        let qtys = [1u64, 3, 7];
        for a in 0..27 {
            for b in 0..27 {
                let sa = o(SIDE_SELL, prices[a % 3], qtys[a / 3 % 3]);
                let sb = o(SIDE_SELL, prices[a / 9], qtys[(a + 1) % 3]);
                let ba = o(SIDE_BUY, prices[b % 3], qtys[b / 3 % 3]);
                let bb = o(SIDE_BUY, prices[b / 9], qtys[(b + 2) % 3]);
                let bk = book(&[sa, sb, ba, bb]);
                let c = clear(&bk);
                let sold: u64 = (0..2).map(|i| c.fills[i]).sum();
                let bought: u64 = (2..4).map(|i| c.fills[i]).sum();
                assert_eq!(sold, c.volume);
                assert_eq!(bought, c.volume);
                for i in 0..4 {
                    assert!(c.fills[i] <= bk[i].qty);
                    if c.fills[i] > 0 {
                        assert!(eligible(&bk[i], c.price));
                    }
                }
            }
        }
    }
}
