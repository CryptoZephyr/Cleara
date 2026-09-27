/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/cleara.json`.
 */
export type Cleara = {
  "address": "AnVHa4HHZHhUTepWnSGwxDLUEmkKyAuD6sHeKPtTSY6W",
  "metadata": {
    "name": "cleara",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Scheduled uniform-price exit auctions for thin tokenized assets"
  },
  "instructions": [
    {
      "name": "cancelOrder",
      "discriminator": [
        95,
        129,
        237,
        240,
        8,
        49,
        223,
        132
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "auction",
          "writable": true
        },
        {
          "name": "baseMint",
          "relations": [
            "auction"
          ]
        },
        {
          "name": "quoteMint",
          "relations": [
            "auction"
          ]
        },
        {
          "name": "ownerBase",
          "writable": true
        },
        {
          "name": "ownerQuote",
          "writable": true
        },
        {
          "name": "baseVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  115,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "auction"
              }
            ]
          }
        },
        {
          "name": "quoteVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  111,
                  116,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "auction"
              }
            ]
          }
        },
        {
          "name": "baseTokenProgram"
        },
        {
          "name": "quoteTokenProgram"
        }
      ],
      "args": [
        {
          "name": "slot",
          "type": "u8"
        }
      ]
    },
    {
      "name": "createAuction",
      "discriminator": [
        234,
        6,
        201,
        246,
        47,
        219,
        176,
        107
      ],
      "accounts": [
        {
          "name": "issuer",
          "writable": true,
          "signer": true
        },
        {
          "name": "auction",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  99,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "issuer"
              },
              {
                "kind": "arg",
                "path": "auctionId"
              }
            ]
          }
        },
        {
          "name": "baseMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "baseVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  115,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "auction"
              }
            ]
          }
        },
        {
          "name": "quoteVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  111,
                  116,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "auction"
              }
            ]
          }
        },
        {
          "name": "feeAccount"
        },
        {
          "name": "baseTokenProgram"
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "auctionId",
          "type": "u64"
        },
        {
          "name": "deadline",
          "type": "i64"
        },
        {
          "name": "settleBy",
          "type": "i64"
        },
        {
          "name": "minBaseQty",
          "type": "u64"
        },
        {
          "name": "feeBps",
          "type": "u16"
        },
        {
          "name": "roster",
          "type": {
            "vec": {
              "defined": {
                "name": "rosterInput"
              }
            }
          }
        }
      ]
    },
    {
      "name": "placeOrder",
      "discriminator": [
        51,
        194,
        155,
        175,
        109,
        130,
        96,
        106
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true
        },
        {
          "name": "auction",
          "writable": true
        },
        {
          "name": "baseMint",
          "relations": [
            "auction"
          ]
        },
        {
          "name": "quoteMint",
          "relations": [
            "auction"
          ]
        },
        {
          "name": "ownerBase",
          "writable": true
        },
        {
          "name": "ownerQuote",
          "writable": true
        },
        {
          "name": "baseVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  115,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "auction"
              }
            ]
          }
        },
        {
          "name": "quoteVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  111,
                  116,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "auction"
              }
            ]
          }
        },
        {
          "name": "baseTokenProgram"
        },
        {
          "name": "quoteTokenProgram"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": "u8"
        },
        {
          "name": "limitPrice",
          "type": "u64"
        },
        {
          "name": "qty",
          "type": "u64"
        }
      ]
    },
    {
      "name": "refundExpired",
      "docs": [
        "After `settle_by`, anyone can return one unsettled order's escrow to its owner.",
        "Per-order so that one frozen or restricted account cannot block everyone else."
      ],
      "discriminator": [
        118,
        153,
        164,
        244,
        40,
        128,
        242,
        250
      ],
      "accounts": [
        {
          "name": "auction",
          "writable": true
        },
        {
          "name": "baseMint",
          "relations": [
            "auction"
          ]
        },
        {
          "name": "quoteMint",
          "relations": [
            "auction"
          ]
        },
        {
          "name": "ownerBase",
          "writable": true
        },
        {
          "name": "ownerQuote",
          "writable": true
        },
        {
          "name": "baseVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  115,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "auction"
              }
            ]
          }
        },
        {
          "name": "quoteVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  111,
                  116,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "auction"
              }
            ]
          }
        },
        {
          "name": "baseTokenProgram"
        },
        {
          "name": "quoteTokenProgram"
        }
      ],
      "args": [
        {
          "name": "slot",
          "type": "u8"
        }
      ]
    },
    {
      "name": "settle",
      "docs": [
        "Clears and settles every order in one instruction. `remaining_accounts` must be,",
        "for each non-empty slot in ascending order: [owner base account, owner quote account]."
      ],
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "auction",
          "writable": true
        },
        {
          "name": "baseMint",
          "relations": [
            "auction"
          ]
        },
        {
          "name": "quoteMint",
          "relations": [
            "auction"
          ]
        },
        {
          "name": "baseVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  115,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "auction"
              }
            ]
          }
        },
        {
          "name": "quoteVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  117,
                  111,
                  116,
                  101,
                  95,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "auction"
              }
            ]
          }
        },
        {
          "name": "feeAccount",
          "writable": true,
          "relations": [
            "auction"
          ]
        },
        {
          "name": "baseTokenProgram"
        },
        {
          "name": "quoteTokenProgram"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "auction",
      "discriminator": [
        218,
        94,
        247,
        242,
        126,
        233,
        131,
        81
      ]
    }
  ],
  "events": [
    {
      "name": "auctionSettled",
      "discriminator": [
        61,
        151,
        131,
        170,
        95,
        203,
        219,
        147
      ]
    },
    {
      "name": "orderCancelled",
      "discriminator": [
        108,
        56,
        128,
        68,
        168,
        113,
        168,
        239
      ]
    },
    {
      "name": "orderPlaced",
      "discriminator": [
        96,
        130,
        204,
        234,
        169,
        219,
        216,
        227
      ]
    },
    {
      "name": "orderRefunded",
      "discriminator": [
        120,
        155,
        10,
        169,
        7,
        98,
        202,
        187
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "badSchedule",
      "msg": "Deadline must be in the future and settle_by after the deadline"
    },
    {
      "code": 6001,
      "name": "feeTooHigh",
      "msg": "Fee exceeds maximum"
    },
    {
      "code": 6002,
      "name": "badRoster",
      "msg": "Roster is empty, too long, has duplicates or invalid allowances"
    },
    {
      "code": 6003,
      "name": "sameMint",
      "msg": "Base and quote mint must differ"
    },
    {
      "code": 6004,
      "name": "unsupportedExtension",
      "msg": "Mint uses an unsupported Token-2022 extension"
    },
    {
      "code": 6005,
      "name": "notOpen",
      "msg": "Auction is not open"
    },
    {
      "code": 6006,
      "name": "pastDeadline",
      "msg": "Order window has closed"
    },
    {
      "code": 6007,
      "name": "beforeDeadline",
      "msg": "Order window has not closed yet"
    },
    {
      "code": 6008,
      "name": "settlementExpired",
      "msg": "Settlement window has passed; use refund_expired"
    },
    {
      "code": 6009,
      "name": "notExpired",
      "msg": "Settlement window has not passed yet"
    },
    {
      "code": 6010,
      "name": "badSide",
      "msg": "Side must be buy (1) or sell (2)"
    },
    {
      "code": 6011,
      "name": "badPrice",
      "msg": "Price must be positive"
    },
    {
      "code": 6012,
      "name": "orderTooSmall",
      "msg": "Order below minimum size"
    },
    {
      "code": 6013,
      "name": "notOnRoster",
      "msg": "Signer is not on the approved roster"
    },
    {
      "code": 6014,
      "name": "allowanceUsed",
      "msg": "Participant has used all order slots"
    },
    {
      "code": 6015,
      "name": "selfTrade",
      "msg": "Participant already has an order on the other side"
    },
    {
      "code": 6016,
      "name": "bookFull",
      "msg": "All order slots are taken"
    },
    {
      "code": 6017,
      "name": "emptySlot",
      "msg": "Slot is empty"
    },
    {
      "code": 6018,
      "name": "notOrderOwner",
      "msg": "Signer does not own this order"
    },
    {
      "code": 6019,
      "name": "wrongAccounts",
      "msg": "Settlement accounts are missing, extra, out of order or mismatched"
    },
    {
      "code": 6020,
      "name": "vaultMismatch",
      "msg": "Vault balance does not match escrowed orders"
    },
    {
      "code": 6021,
      "name": "mathError",
      "msg": "Arithmetic error"
    }
  ],
  "types": [
    {
      "name": "auction",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "issuer",
            "type": "pubkey"
          },
          {
            "name": "auctionId",
            "type": "u64"
          },
          {
            "name": "baseMint",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "baseDecimals",
            "type": "u8"
          },
          {
            "name": "quoteDecimals",
            "type": "u8"
          },
          {
            "name": "feeAccount",
            "type": "pubkey"
          },
          {
            "name": "deadline",
            "type": "i64"
          },
          {
            "name": "settleBy",
            "type": "i64"
          },
          {
            "name": "minBaseQty",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "status",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "baseVaultBump",
            "type": "u8"
          },
          {
            "name": "quoteVaultBump",
            "type": "u8"
          },
          {
            "name": "clearingPrice",
            "type": "u64"
          },
          {
            "name": "clearedVolume",
            "type": "u64"
          },
          {
            "name": "orders",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "order"
                  }
                },
                8
              ]
            }
          },
          {
            "name": "roster",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "rosterEntry"
                  }
                },
                8
              ]
            }
          },
          {
            "name": "rosterLen",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "auctionSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "auction",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "volume",
            "type": "u64"
          },
          {
            "name": "fees",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "order",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "limitPrice",
            "docs": [
              "Quote atoms per one whole base token."
            ],
            "type": "u64"
          },
          {
            "name": "qty",
            "docs": [
              "Base atoms."
            ],
            "type": "u64"
          },
          {
            "name": "escrowed",
            "docs": [
              "Base atoms (sell) or quote atoms (buy) held in the vault for this order."
            ],
            "type": "u64"
          },
          {
            "name": "filled",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "auction",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "orderPlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "auction",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u8"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "limitPrice",
            "type": "u64"
          },
          {
            "name": "qty",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "orderRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "auction",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "rosterEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "participant",
            "type": "pubkey"
          },
          {
            "name": "allowance",
            "type": "u8"
          },
          {
            "name": "active",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "rosterInput",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "participant",
            "type": "pubkey"
          },
          {
            "name": "allowance",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
