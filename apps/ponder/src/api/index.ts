import { and, eq, gt, graphql, inArray, sql } from "ponder";
import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import type { Hex } from "viem";

const app = new Hono();

// Serve GraphQL on root and /graphql
app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

// Health check
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: Date.now(),
    service: "morpho-ponder-indexer",
  });
});

// List all markets
app.get("/api/markets", async (c) => {
  const markets = await db.select().from(schema.market);

  return c.json({
    count: markets.length,
    markets: markets.map((m) => ({
      id: m.id,
      chainId: m.chainId,
      loanToken: m.loanToken,
      collateralToken: m.collateralToken,
      oracle: m.oracle,
      irm: m.irm,
      lltv: m.lltv.toString(),
      totalSupplyAssets: m.totalSupplyAssets.toString(),
      totalSupplyShares: m.totalSupplyShares.toString(),
      totalBorrowAssets: m.totalBorrowAssets.toString(),
      totalBorrowShares: m.totalBorrowShares.toString(),
      lastUpdate: m.lastUpdate.toString(),
      fee: m.fee.toString(),
    })),
  });
});

// Get market by ID
app.get("/api/markets/:marketId", async (c) => {
  const marketId = c.req.param("marketId") as Hex;

  const result = await db.query.market.findFirst({
    where: (row) => and(eq(row.id, marketId)),
  });

  if (!result) {
    return c.json({ error: "Market not found" }, 404);
  }

  const m = result;
  return c.json({
    id: m.id,
    chainId: m.chainId,
    loanToken: m.loanToken,
    collateralToken: m.collateralToken,
    oracle: m.oracle,
    irm: m.irm,
    lltv: m.lltv.toString(),
    totalSupplyAssets: m.totalSupplyAssets.toString(),
    totalSupplyShares: m.totalSupplyShares.toString(),
    totalBorrowAssets: m.totalBorrowAssets.toString(),
    totalBorrowShares: m.totalBorrowShares.toString(),
    lastUpdate: m.lastUpdate.toString(),
    fee: m.fee.toString(),
  });
});

// Get positions with debt (potential liquidation candidates)
app.get("/api/positions", async (c) => {
  const marketIdParam = c.req.query("marketId") as Hex | undefined;
  const limitParam = parseInt(c.req.query("limit") || "1000", 10);
  const limit = Math.min(limitParam, 5000);

  const conditions = marketIdParam
    ? and(gt(schema.position.borrowShares, 0n), eq(schema.position.marketId, marketIdParam))
    : gt(schema.position.borrowShares, 0n);

  const positions = await db
    .select()
    .from(schema.position)
    .where(conditions)
    .limit(limit);

  return c.json({
    count: positions.length,
    positions: positions.map((p) => ({
      chainId: p.chainId,
      marketId: p.marketId,
      user: p.user,
      supplyShares: p.supplyShares.toString(),
      borrowShares: p.borrowShares.toString(),
      collateral: p.collateral.toString(),
    })),
  });
});

// Get positions for a specific user
app.get("/api/positions/:user", async (c) => {
  const userAddress = c.req.param("user") as Hex;

  const positions = await db
    .select()
    .from(schema.position)
    .where(eq(schema.position.user, userAddress));

  return c.json({
    user: userAddress,
    count: positions.length,
    positions: positions.map((p) => ({
      chainId: p.chainId,
      marketId: p.marketId,
      supplyShares: p.supplyShares.toString(),
      borrowShares: p.borrowShares.toString(),
      collateral: p.collateral.toString(),
    })),
  });
});

// POST /api/candidates - Liquidation candidates for given market IDs
app.post("/api/candidates", async (c) => {
  const body = await c.req.json();
  const { marketIds, limit: limitParam } = body as {
    marketIds: string[];
    limit?: number;
  };

  if (!Array.isArray(marketIds) || marketIds.length === 0) {
    return c.json({ error: "marketIds must be a non-empty array" }, 400);
  }

  const limit = Math.min(limitParam || 1000, 5000);

  const positions = await db
    .select()
    .from(schema.position)
    .where(
      and(
        inArray(schema.position.marketId, marketIds as Hex[]),
        gt(schema.position.borrowShares, 0n),
      ),
    )
    .limit(limit);

  const markets = await db
    .select()
    .from(schema.market)
    .where(inArray(schema.market.id, marketIds as Hex[]));

  const marketMap = new Map(markets.map((m) => [m.id, m]));

  const candidates = positions.map((p) => {
    const m = marketMap.get(p.marketId);

    let borrowAssets = 0n;
    if (m && m.totalBorrowShares > 0n) {
      borrowAssets = (p.borrowShares * m.totalBorrowAssets) / m.totalBorrowShares;
    }

    return {
      marketId: p.marketId,
      user: p.user,
      loanToken: m?.loanToken,
      collateralToken: m?.collateralToken,
      oracle: m?.oracle,
      lltv: m?.lltv.toString(),
      borrowShares: p.borrowShares.toString(),
      borrowAssets: borrowAssets.toString(),
      collateral: p.collateral.toString(),
      supplyShares: p.supplyShares.toString(),
      totalBorrowAssets: m?.totalBorrowAssets.toString(),
      totalBorrowShares: m?.totalBorrowShares.toString(),
    };
  });

  return c.json({
    count: candidates.length,
    candidates,
  });
});

// GET /api/stats - Indexer statistics
app.get("/api/stats", async (c) => {
  const marketCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.market);

  const positionCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.position);

  const debtPositionCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.position)
    .where(gt(schema.position.borrowShares, 0n));

  return c.json({
    markets: Number(marketCount[0]?.count || 0),
    positions: Number(positionCount[0]?.count || 0),
    positionsWithDebt: Number(debtPositionCount[0]?.count || 0),
    timestamp: Date.now(),
  });
});

export default app;
