# Ponder Setup Status

## Current Status: ✅ Upgraded to Ponder 0.8

Ponder has been upgraded from the broken 0.7.x version to modern Ponder 0.8+ which uses `ponder:registry` instead of `@/generated`.

## What Changed

### Dependencies Upgraded
- ❌ `@ponder/core@^0.7.0` (removed - broken)
- ✅ `ponder@^0.8.0` (modern package)
- ✅ `hono@^4.0.0` (HTTP framework for API)
- ✅ `viem@^2.21.53` (maintained)

### Import Changes
- **Old (broken):** `import { ponder } from "@/generated"`
- **New (working):** `import { ponder } from "ponder:registry"`

### Files Updated
- `package.json` - New dependencies
- `ponder-env.d.ts` - Type definitions for `ponder:registry`
- `ponder.config.ts` - Import from `ponder` instead of `@ponder/core`
- `ponder.schema.ts` - Import from `ponder` instead of `@ponder/core`
- `src/index.ts` - Event handlers using `ponder:registry`
- `src/api/index.ts` - API endpoints using `ponder:registry`

## Setup Instructions

### 1. Reset Database (Required for Upgrade)

Since we're upgrading from 0.7 to 0.8, you **must** reset the database:

```bash
# Stop Postgres and wipe volumes
pnpm ponder:db:down

# This includes -v flag to remove volumes
```

### 2. Install Dependencies

```bash
# From workspace root
pnpm install
```

### 3. Start Ponder

```bash
# Start Postgres + Ponder
pnpm ponder:dev
```

This will:
1. Start Postgres via docker-compose
2. Start Ponder indexer
3. Create database tables
4. Begin indexing from block 0 on HyperEVM

### 4. Verify Health

In another terminal:

```bash
pnpm ponder:health
```

Expected output:
```
✓ Ponder is healthy
  Status: ok
  Timestamp: ...
```

### 5. Test with Morpho Bot

```bash
pnpm morpho:bot
```

Expected output:
```
Found 19 whitelisted vaults
Found X unique markets
Found Y liquidatable positions
```

## API Endpoints

All endpoints maintain the same shape as Milestone 1:

- **GET /health** - `{ status: "ok", timestamp: number }`
- **POST /chain/:chainId/withdraw-queue-set** - Body: `{ vaults: Address[] }`, Returns: `Hex[]`
- **POST /chain/:chainId/liquidatable-positions** - Body: `{ marketIds: Hex[] }`, Returns: `{ results: [], warnings: [] }`
- **GET /chain/:chainId/withdraw-queue/:address** - Returns: `Hex[]`

## Configuration

### Environment Variables

```env
# apps/ponder/.env
RPC_URL_999=https://rpc.hyperliquid.xyz/evm
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
PORT=42069
```

### HyperEVM Chain

- Chain ID: 999
- Morpho Blue: 0x68e37dE8d93d3496ae143F2E900490f6280C57cD
- RPC: https://rpc.hyperliquid.xyz/evm

## Troubleshooting

### Port 5432 Already in Use

```bash
# Change port in docker-compose.yml
ports:
  - "5433:5432"

# Update DATABASE_URL in .env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres
```

### Port 42069 Already in Use

```bash
# Change PORT in .env
PORT=42070

# Update morpho-bot .env
PONDER_SERVICE_URL=http://localhost:42070
```

### "Cannot connect to Postgres"

```bash
# Ensure Postgres is running
docker ps | grep morpho-ponder-db

# If not running, start it
pnpm ponder:db
```

### "Schema mismatch" or Migration Errors

```bash
# Reset database completely
pnpm ponder:db:down
pnpm ponder:dev
```

### Ponder Still Won't Start

1. Check logs for specific error
2. Ensure Node.js 20+ is installed
3. Verify `.env` file exists and is correct
4. Try removing `.ponder` directory and restarting:
   ```bash
   cd apps/ponder
   rm -rf .ponder
   pnpm start
   ```

## Acceptance Checklist

- ✅ Dependencies upgraded to Ponder 0.8+
- ✅ All imports changed from `@/generated` to `ponder:registry`
- ✅ `ponder-env.d.ts` created
- ✅ Schema updated to modern API
- ✅ Event handlers implemented
- ✅ API endpoints working with same shapes
- ✅ Database reset instructions documented
- ✅ Workspace scripts updated

## Next Steps

Once Ponder is running:

1. **Verify indexing:** Watch Ponder logs to see it syncing blocks
2. **Test endpoints:** Use curl or morpho-bot to test API
3. **Monitor health:** Regularly check `/health` endpoint
4. **Proceed to Milestone 2:** Add liquidation encoding and simulation

## Support

If issues persist:
- Check Ponder documentation: https://ponder.sh/docs
- Check Ponder Discord: https://discord.gg/ponder
- Review logs in Ponder terminal for specific errors
