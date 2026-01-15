# Ponder Upgrade Complete! 🎉

## What Was Fixed

Upgraded from **broken Ponder 0.7.x** to **modern Ponder 0.8.33** which uses `ponder:registry` instead of the broken `@/generated` import approach.

## Updated Dependencies

### apps/ponder/package.json

```json
{
  "dependencies": {
    "ponder": "^0.8.0",     // Was: "@ponder/core": "^0.7.0"
    "hono": "^4.0.0",       // New: HTTP framework
    "viem": "^2.21.53"      // Maintained
  }
}
```

## Commands to Start Ponder

### 1. **First Time / After Upgrade: Reset Database**

```bash
# Stop Postgres and wipe volumes (required when upgrading Ponder versions)
pnpm ponder:db:down

# Start Postgres
pnpm ponder:db
```

### 2. **Start Ponder**

```bash
# From workspace root
pnpm ponder:dev
```

This runs:
1. `pnpm ponder:db` - Starts Postgres via docker-compose
2. `pnpm ponder:start` - Starts Ponder indexer

### 3. **Verify Health**

In another terminal:

```bash
pnpm ponder:health
```

Expected output:
```
✓ Ponder is healthy
  Status: ok
  Timestamp: 1705234567890
```

### 4. **Test with Morpho Bot**

```bash
pnpm morpho:bot
```

Expected output:
```
Found 19 whitelisted vaults
Found X unique markets  
Found Y liquidatable positions
✓ Milestone 1 complete
```

## What Changed Technically

### Import Changes (All Files)

**Before (broken):**
```typescript
import { ponder } from "@/generated";
import { createConfig } from "@ponder/core";
import { onchainTable } from "@ponder/core";
```

**After (working):**
```typescript
import { ponder } from "ponder:registry";
import { createConfig } from "ponder";
import { onchainTable } from "ponder";
```

### Files Modified

1. **package.json** - New dependencies
2. **ponder-env.d.ts** - Created (type definitions for `ponder:registry`)
3. **ponder.config.ts** - Updated imports
4. **ponder.schema.ts** - Updated imports
5. **src/index.ts** - Rewritten with modern API + event handlers
6. **src/api/index.ts** - Rewritten with modern API + HTTP endpoints

### API Endpoints (Unchanged Shape)

All endpoints maintain the same interface as Milestone 1:

- ✅ **GET /health** → `{ status: "ok", timestamp: number }`
- ✅ **POST /chain/:chainId/withdraw-queue-set** → `Hex[]`
- ✅ **POST /chain/:chainId/liquidatable-positions** → `{ results: [], warnings: [] }`
- ✅ **GET /chain/:chainId/withdraw-queue/:address** → `Hex[]`

## Troubleshooting

### If Ponder Still Fails

**1. Database Already Exists from 0.7**
```bash
# Reset database completely
pnpm ponder:db:down
docker volume rm morpho-ponder-db_ponder-db-data
pnpm ponder:dev
```

**2. Port Conflicts**

Port 5432 (Postgres):
```bash
# Edit apps/ponder/docker-compose.yml
ports:
  - "5433:5432"  # Change host port

# Update apps/ponder/.env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres
```

Port 42069 (Ponder):
```bash
# Edit apps/ponder/.env
PORT=42070

# Update apps/morpho-bot/.env
PONDER_SERVICE_URL=http://localhost:42070
```

**3. Colima/Docker Not Running**
```bash
# Start Colima
colima start

# Or start Docker Desktop
open -a Docker
```

**4. Permission Issues**
```bash
# Clean install
cd /Users/eloimagniez/liquidator
rm -rf node_modules apps/*/node_modules
pnpm install
```

**5. ".ponder" Directory Issues**
```bash
cd apps/ponder
rm -rf .ponder
pnpm start
```

### Checking Logs

```bash
# Ponder logs: visible in terminal where pnpm ponder:dev is running
# Postgres logs:
docker logs morpho-ponder-db

# Follow Postgres logs:
docker logs -f morpho-ponder-db
```

## Acceptance Tests

Run these in order:

```bash
# 1. Install dependencies
pnpm install

# 2. Reset database (first time or after upgrade)
pnpm ponder:db:down

# 3. Start Postgres
pnpm ponder:db

# 4. Start Ponder
pnpm ponder:dev
# Wait for "Syncing..." messages

# 5. In another terminal, check health
pnpm ponder:health
# Expected: ✓ Ponder is healthy

# 6. Test morpho bot
pnpm morpho:bot
# Expected: Fetches vaults, markets, positions successfully
```

## Configuration

### apps/ponder/.env

```env
RPC_URL_999=https://rpc.hyperliquid.xyz/evm
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
PORT=42069
```

### HyperEVM Constants

- **Chain ID:** 999
- **Morpho Blue:** 0x68e37dE8d93d3496ae143F2E900490f6280C57cD
- **RPC:** https://rpc.hyperliquid.xyz/evm
- **Start Block:** 0 (indexes from genesis)

## Workspace Scripts

| Script | Description |
|--------|-------------|
| `pnpm ponder:db` | Start Postgres |
| `pnpm ponder:db:down` | Stop Postgres + wipe volumes |
| `pnpm ponder:start` | Start Ponder indexer |
| `pnpm ponder:dev` | Start DB + Ponder (recommended) |
| `pnpm ponder:health` | Check health endpoint |
| `pnpm morpho:bot` | Run Morpho bot (requires Ponder) |

## Performance Notes

### Indexing Speed

- Ponder will index from block 0 to current
- Initial sync may take 5-30 minutes depending on:
  - RPC speed
  - Number of events
  - Postgres performance
- Progress is shown in Ponder terminal

### Database Size

- Expect ~100MB-1GB depending on chain activity
- Volume: `morpho-ponder-db_ponder-db-data`
- Location: Docker volume (persists across restarts)

## Next Steps

1. **✅ Ponder is now running** - infrastructure complete
2. **✅ Morpho bot Milestone 1** - already working
3. **→ Milestone 2 (Next)** - Add liquidation encoding + simulation
4. **→ Milestone 3** - Deploy executor + send transactions
5. **→ Milestone 4** - Add flashloan mode

## Support

- **Ponder Docs:** https://ponder.sh/docs
- **Ponder Discord:** https://discord.gg/ponder
- **Status File:** `apps/ponder/STATUS.md`
- **Setup Guide:** `apps/ponder/SETUP.md`

---

**Congratulations!** 🎉 Ponder is now upgraded and ready to use. The circular dependency issue is resolved.
