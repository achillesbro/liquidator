import { ponder } from "ponder:registry";
import { market, position } from "ponder:schema";

function zeroFloorSub(x: bigint, y: bigint) {
  return x < y ? 0n : x - y;
}

/*//////////////////////////////////////////////////////////////
                          MARKET EVENTS
//////////////////////////////////////////////////////////////*/

ponder.on("MorphoBlue:CreateMarket", async ({ event, context }) => {
  await context.db.insert(market).values({
    chainId: context.chain.id,
    id: event.args.id,
    loanToken: event.args.marketParams.loanToken,
    collateralToken: event.args.marketParams.collateralToken,
    oracle: event.args.marketParams.oracle,
    irm: event.args.marketParams.irm,
    lltv: event.args.marketParams.lltv,
    lastUpdate: event.block.timestamp,
  });
});

ponder.on("MorphoBlue:SetFee", async ({ event, context }) => {
  await context.db
    .update(market, { chainId: context.chain.id, id: event.args.id })
    .set({ fee: event.args.newFee });
});

ponder.on("MorphoBlue:AccrueInterest", async ({ event, context }) => {
  await context.db
    .update(market, { chainId: context.chain.id, id: event.args.id })
    .set((row) => ({
      totalSupplyAssets: row.totalSupplyAssets + event.args.interest,
      totalSupplyShares: row.totalSupplyShares + event.args.feeShares,
      totalBorrowAssets: row.totalBorrowAssets + event.args.interest,
      lastUpdate: event.block.timestamp,
    }));
});

/*//////////////////////////////////////////////////////////////
                      SUPPLY / WITHDRAW
//////////////////////////////////////////////////////////////*/

ponder.on("MorphoBlue:Supply", async ({ event, context }) => {
  await Promise.all([
    context.db
      .update(market, { chainId: context.chain.id, id: event.args.id })
      .set((row) => ({
        totalSupplyAssets: row.totalSupplyAssets + event.args.assets,
        totalSupplyShares: row.totalSupplyShares + event.args.shares,
      })),
    context.db
      .insert(position)
      .values({
        chainId: context.chain.id,
        marketId: event.args.id,
        user: event.args.onBehalf,
        supplyShares: event.args.shares,
      })
      .onConflictDoUpdate((row) => ({
        supplyShares: row.supplyShares + event.args.shares,
      })),
  ]);
});

ponder.on("MorphoBlue:Withdraw", async ({ event, context }) => {
  await Promise.all([
    context.db
      .update(market, { chainId: context.chain.id, id: event.args.id })
      .set((row) => ({
        totalSupplyAssets: row.totalSupplyAssets - event.args.assets,
        totalSupplyShares: row.totalSupplyShares - event.args.shares,
      })),
    context.db
      .update(position, {
        chainId: context.chain.id,
        marketId: event.args.id,
        user: event.args.onBehalf,
      })
      .set((row) => ({
        supplyShares: row.supplyShares - event.args.shares,
      })),
  ]);
});

/*//////////////////////////////////////////////////////////////
                        BORROW / REPAY
//////////////////////////////////////////////////////////////*/

ponder.on("MorphoBlue:Borrow", async ({ event, context }) => {
  await Promise.all([
    context.db
      .update(market, { chainId: context.chain.id, id: event.args.id })
      .set((row) => ({
        totalBorrowAssets: row.totalBorrowAssets + event.args.assets,
        totalBorrowShares: row.totalBorrowShares + event.args.shares,
      })),
    context.db
      .update(position, {
        chainId: context.chain.id,
        marketId: event.args.id,
        user: event.args.onBehalf,
      })
      .set((row) => ({
        borrowShares: row.borrowShares + event.args.shares,
      })),
  ]);
});

ponder.on("MorphoBlue:Repay", async ({ event, context }) => {
  await Promise.all([
    context.db
      .update(market, { chainId: context.chain.id, id: event.args.id })
      .set((row) => ({
        totalBorrowAssets: row.totalBorrowAssets - event.args.assets,
        totalBorrowShares: row.totalBorrowShares - event.args.shares,
      })),
    context.db
      .update(position, {
        chainId: context.chain.id,
        marketId: event.args.id,
        user: event.args.onBehalf,
      })
      .set((row) => ({
        borrowShares: row.borrowShares - event.args.shares,
      })),
  ]);
});

/*//////////////////////////////////////////////////////////////
                          COLLATERAL
//////////////////////////////////////////////////////////////*/

ponder.on("MorphoBlue:SupplyCollateral", async ({ event, context }) => {
  await context.db
    .insert(position)
    .values({
      chainId: context.chain.id,
      marketId: event.args.id,
      user: event.args.onBehalf,
      collateral: event.args.assets,
    })
    .onConflictDoUpdate((row) => ({
      collateral: row.collateral + event.args.assets,
    }));
});

ponder.on("MorphoBlue:WithdrawCollateral", async ({ event, context }) => {
  await context.db
    .update(position, {
      chainId: context.chain.id,
      marketId: event.args.id,
      user: event.args.onBehalf,
    })
    .set((row) => ({
      collateral: row.collateral - event.args.assets,
    }));
});

/*//////////////////////////////////////////////////////////////
                          LIQUIDATION
//////////////////////////////////////////////////////////////*/

ponder.on("MorphoBlue:Liquidate", async ({ event, context }) => {
  await Promise.all([
    context.db
      .update(market, { chainId: context.chain.id, id: event.args.id })
      .set((row) => ({
        totalSupplyAssets: row.totalSupplyAssets - event.args.badDebtAssets,
        totalSupplyShares: row.totalSupplyShares - event.args.badDebtShares,
        totalBorrowAssets: zeroFloorSub(
          row.totalBorrowAssets,
          event.args.repaidAssets + event.args.badDebtAssets,
        ),
        totalBorrowShares:
          row.totalBorrowShares - event.args.repaidShares - event.args.badDebtShares,
      })),
    context.db
      .update(position, {
        chainId: context.chain.id,
        marketId: event.args.id,
        user: event.args.borrower,
      })
      .set((row) => ({
        collateral: row.collateral - event.args.seizedAssets,
        borrowShares: row.borrowShares - event.args.repaidShares - event.args.badDebtShares,
      })),
  ]);
});
