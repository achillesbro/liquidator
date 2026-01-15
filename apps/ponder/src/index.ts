import { ponder } from "ponder:registry";
import { eq, and, inArray } from "ponder";

// Event handlers for Morpho Blue
// These populate the database tables defined in ponder.schema.ts

ponder.on("MorphoBlue:CreateMarket", async ({ event, context }) => {
  const { db } = context;
  const { id, marketParams } = event.args;

  await db
    .insert(db.sql.market)
    .values({
      id,
      chainId: 999,
      loanToken: marketParams.loanToken,
      collateralToken: marketParams.collateralToken,
      oracle: marketParams.oracle,
      irm: marketParams.irm,
      lltv: marketParams.lltv,
      totalSupplyAssets: 0n,
      totalSupplyShares: 0n,
      totalBorrowAssets: 0n,
      totalBorrowShares: 0n,
      lastUpdate: event.block.timestamp,
      fee: 0n,
    })
    .onConflictDoNothing();
});

ponder.on("MorphoBlue:Supply", async ({ event, context }) => {
  const { db } = context;
  const { id, onBehalf, shares } = event.args;
  const positionId = `999-${id}-${onBehalf}`;

  const existing = await db
    .select()
    .from(db.sql.position)
    .where(eq(db.sql.position.id, positionId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(db.sql.position)
      .set({
        supplyShares: existing[0].supplyShares + shares,
      })
      .where(eq(db.sql.position.id, positionId));
  } else {
    await db
      .insert(db.sql.position)
      .values({
        id: positionId,
        chainId: 999,
        marketId: id,
        user: onBehalf,
        supplyShares: shares,
        borrowShares: 0n,
        collateral: 0n,
      })
      .onConflictDoNothing();
  }
});

ponder.on("MorphoBlue:Borrow", async ({ event, context }) => {
  const { db } = context;
  const { id, onBehalf, shares } = event.args;
  const positionId = `999-${id}-${onBehalf}`;

  const existing = await db
    .select()
    .from(db.sql.position)
    .where(eq(db.sql.position.id, positionId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(db.sql.position)
      .set({
        borrowShares: existing[0].borrowShares + shares,
      })
      .where(eq(db.sql.position.id, positionId));
  } else {
    await db
      .insert(db.sql.position)
      .values({
        id: positionId,
        chainId: 999,
        marketId: id,
        user: onBehalf,
        supplyShares: 0n,
        borrowShares: shares,
        collateral: 0n,
      })
      .onConflictDoNothing();
  }
});

ponder.on("MorphoBlue:SupplyCollateral", async ({ event, context }) => {
  const { db } = context;
  const { id, onBehalf, assets } = event.args;
  const positionId = `999-${id}-${onBehalf}`;

  const existing = await db
    .select()
    .from(db.sql.position)
    .where(eq(db.sql.position.id, positionId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(db.sql.position)
      .set({
        collateral: existing[0].collateral + assets,
      })
      .where(eq(db.sql.position.id, positionId));
  } else {
    await db
      .insert(db.sql.position)
      .values({
        id: positionId,
        chainId: 999,
        marketId: id,
        user: onBehalf,
        supplyShares: 0n,
        borrowShares: 0n,
        collateral: assets,
      })
      .onConflictDoNothing();
  }
});

ponder.on("MorphoBlue:Liquidate", async ({ event, context }) => {
  const { db } = context;
  const { id, borrower, seizedAssets, repaidShares } = event.args;
  const positionId = `999-${id}-${borrower}`;

  const existing = await db
    .select()
    .from(db.sql.position)
    .where(eq(db.sql.position.id, positionId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(db.sql.position)
      .set({
        borrowShares: existing[0].borrowShares - repaidShares,
        collateral: existing[0].collateral - seizedAssets,
      })
      .where(eq(db.sql.position.id, positionId));
  }
});
