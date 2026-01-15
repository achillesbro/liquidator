import { ponder } from "ponder:registry";
import { eq, inArray, gt } from "ponder";

// HTTP API endpoints for Morpho bot
// These endpoints must maintain the same shape as Milestone 1 expects

// Note: /health and /status are automatically provided by Ponder 0.8
// We'll create a custom endpoint for backward compatibility with morpho-bot
ponder.get("/api/health", (c) => {
  return c.json({ status: "ok", timestamp: Date.now() });
});

// POST /chain/:chainId/withdraw-queue-set
// Returns array of market IDs from vaults' withdraw queues
ponder.post("/chain/:chainId/withdraw-queue-set", async (c) => {
  const chainId = parseInt(c.req.param("chainId"), 10);
  const body = await c.req.json();
  const { vaults } = body as { vaults: string[] };

  if (!Array.isArray(vaults)) {
    return c.json({ error: "vaults must be an array" }, 400);
  }

  const { db } = c.var;

  // Query vaults from database
  const vaultRecords = await db
    .select()
    .from(db.sql.vault)
    .where(
      and(
        eq(db.sql.vault.chainId, chainId),
        inArray(db.sql.vault.address, vaults)
      )
    );

  // Collect unique market IDs from withdraw queues
  const marketIds = new Set<string>();
  for (const vault of vaultRecords) {
    if (vault.withdrawQueue && Array.isArray(vault.withdrawQueue)) {
      for (const marketId of vault.withdrawQueue) {
        marketIds.add(marketId);
      }
    }
  }

  return c.json(Array.from(marketIds));
});

// POST /chain/:chainId/liquidatable-positions
// Returns liquidatable positions for given markets
ponder.post("/chain/:chainId/liquidatable-positions", async (c) => {
  const chainId = parseInt(c.req.param("chainId"), 10);
  const body = await c.req.json();
  const { marketIds } = body as { marketIds: string[] };

  if (!Array.isArray(marketIds)) {
    return c.json({ error: "marketIds must be an array" }, 400);
  }

  const { db } = c.var;

  // Query positions with debt in these markets
  const positions = await db
    .select()
    .from(db.sql.position)
    .where(
      and(
        eq(db.sql.position.chainId, chainId),
        inArray(db.sql.position.marketId, marketIds),
        gt(db.sql.position.borrowShares, 0n)
      )
    );

  // Query markets to get token addresses
  const markets = await db
    .select()
    .from(db.sql.market)
    .where(
      and(
        eq(db.sql.market.chainId, chainId),
        inArray(db.sql.market.id, marketIds)
      )
    );

  const marketMap = new Map(markets.map((m) => [m.id, m]));

  // Format results to match Milestone 1 expectations
  const results = positions.map((pos) => {
    const market = marketMap.get(pos.marketId);

    return {
      marketId: pos.marketId,
      user: pos.user,
      loanToken: market?.loanToken,
      collateralToken: market?.collateralToken,
      borrowShares: pos.borrowShares.toString() + "n",
      collateral: pos.collateral.toString() + "n",
      supplyShares: pos.supplyShares.toString() + "n",
      // Placeholder values for Milestone 1
      seizableCollateral: pos.collateral.toString() + "n",
      repaidShares: pos.borrowShares.toString() + "n",
    };
  });

  return c.json({ results, warnings: [] });
});

// GET /chain/:chainId/withdraw-queue/:address
// Returns withdraw queue for a specific vault
ponder.get("/chain/:chainId/withdraw-queue/:address", async (c) => {
  const chainId = parseInt(c.req.param("chainId"), 10);
  const address = c.req.param("address");

  const { db } = c.var;

  const vault = await db
    .select()
    .from(db.sql.vault)
    .where(
      and(
        eq(db.sql.vault.chainId, chainId),
        eq(db.sql.vault.address, address as `0x${string}`)
      )
    )
    .limit(1);

  if (vault.length === 0) {
    return c.json({ error: "Vault not found" }, 404);
  }

  return c.json(vault[0].withdrawQueue || []);
});
