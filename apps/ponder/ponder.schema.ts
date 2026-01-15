import { onchainTable, index } from "ponder";

// Market table - stores Morpho Blue market data
export const market = onchainTable(
  "market",
  (t) => ({
    id: t.hex().primaryKey(),
    chainId: t.integer().notNull(),
    loanToken: t.hex().notNull(),
    collateralToken: t.hex().notNull(),
    oracle: t.hex().notNull(),
    irm: t.hex().notNull(),
    lltv: t.bigint().notNull(),
    totalSupplyAssets: t.bigint().notNull(),
    totalSupplyShares: t.bigint().notNull(),
    totalBorrowAssets: t.bigint().notNull(),
    totalBorrowShares: t.bigint().notNull(),
    lastUpdate: t.bigint().notNull(),
    fee: t.bigint().notNull(),
  }),
  (table) => ({
    chainIdIdx: index().on(table.chainId),
  })
);

// Position table - stores user positions in markets
export const position = onchainTable(
  "position",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    marketId: t.hex().notNull(),
    user: t.hex().notNull(),
    supplyShares: t.bigint().notNull(),
    borrowShares: t.bigint().notNull(),
    collateral: t.bigint().notNull(),
  }),
  (table) => ({
    marketUserIdx: index().on(table.marketId, table.user),
  })
);

// Vault table - stores MetaMorpho vault data with withdraw queues
export const vault = onchainTable(
  "vault",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    address: t.hex().notNull(),
    withdrawQueue: t.text().array().notNull(),
  }),
  (table) => ({
    addressIdx: index().on(table.address),
  })
);
