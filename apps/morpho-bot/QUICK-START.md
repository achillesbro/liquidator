# Morpho Bot - Quick Start Guide

## Installation

From the workspace root:

```bash
pnpm install
```

## Configuration

1. Copy the example environment file:
   ```bash
   cd apps/morpho-bot
   cp .env.example .env
   ```

2. Edit `.env` if needed (defaults work for most cases):
   ```env
   PONDER_SERVICE_URL=http://localhost:42069
   MORPHO_API_URL=https://blue-api.morpho.org
   CHAIN_ID=999
   ```

## Running

From workspace root:
```bash
pnpm morpho:bot
```

Or from `apps/morpho-bot`:
```bash
pnpm start
```

## Expected Output

### Success (with Ponder running):
```
Initializing Morpho Bot...
Chain ID: 999
Ponder URL: http://localhost:42069
Morpho API URL: https://blue-api.morpho.org

[1/3] Fetching whitelisted vaults from Morpho API...
Found 19 whitelisted vaults

[2/3] Fetching markets from Ponder withdraw-queue-set...
Found 12 unique markets

[3/3] Fetching liquidatable positions from Ponder...
Found 5 liquidatable positions

============================================================
MORPHO BOT · HYPEREVM · MILESTONE 1
============================================================
Vaults: 19 | Markets: 12 | Liquidatable positions: 5
============================================================

Liquidatable Positions:
------------------------------------------------------------
[1] marketId=0x1234...5678 user=0xabcd...ef01 ...
...

✓ Milestone 1 complete: data flow established
```

### Ponder Not Running:
```
[2/3] Fetching markets from Ponder withdraw-queue-set...
Retry 1/3 for fetch markets from Ponder after 1000ms: fetch failed
...

❌ Error: Failed to fetch markets from Ponder after 3 attempts: fetch failed

💡 Make sure Ponder indexer is running at the configured URL.
```

## Prerequisites

- **Node.js 18+** (for native fetch support)
- **Ponder indexer** (optional for Milestone 1 testing, but shows graceful failure)

## Troubleshooting

### "fetch failed" error
- Ensure Ponder indexer is running at configured URL
- Check `PONDER_SERVICE_URL` in `.env`
- Default: `http://localhost:42069`

### "Morpho API error"
- Check internet connection
- Verify `MORPHO_API_URL` is correct
- Default: `https://blue-api.morpho.org`

### No vaults found
- Confirm chainId 999 (HyperEVM) has listed vaults
- Check `CHAIN_ID` in `.env`

## File Structure

```
apps/morpho-bot/
├── src/
│   ├── index.js              # Main entry point
│   └── lib/
│       ├── env.js            # Config loader
│       ├── morphoApi.js      # Morpho API client (GraphQL)
│       ├── ponder.js         # Ponder HTTP client
│       ├── report.js         # Output formatter
│       └── retry.js          # HTTP retry utility
├── .env.example              # Config template
├── package.json              # Package config
├── README.md                 # Full documentation
├── MILESTONE-1-SUMMARY.md    # Implementation details
└── QUICK-START.md           # This file
```

## What Milestone 1 Does

- ✅ Fetches whitelisted vaults from Morpho API (GraphQL)
- ✅ Queries Ponder for markets in vaults' withdraw queues
- ✅ Queries Ponder for liquidatable positions
- ✅ Prints formatted report to CLI
- ❌ No encoding (Milestone 2)
- ❌ No simulation (Milestone 2)
- ❌ No transactions (Milestone 3)

## Next Steps

Once Ponder indexer is deployed:
1. Start Ponder: `pnpm dev` (in Ponder project)
2. Run bot: `pnpm morpho:bot` (in liquidator workspace)
3. Bot will fetch and display liquidatable positions

For Milestone 2:
- Build call encoders for liquidation
- Add LiquidSwap integration
- Add profitability checks
