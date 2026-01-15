# Ponder Setup Guide

Complete setup instructions for running Ponder indexer for Morpho Blue on HyperEVM.

## File Structure Created

```
apps/ponder/
├── abis/
│   └── MorphoBlue.json           # Morpho Blue contract ABI (events)
├── scripts/
│   └── healthcheck.js            # Health check utility script
├── src/
│   ├── index.ts                  # Event handlers for Morpho Blue
│   └── api/
│       └── index.ts              # HTTP API endpoints
├── .env.example                  # Environment variables template
├── .gitignore                    # Ponder-specific gitignore
├── docker-compose.yml            # Postgres container setup
├── package.json                  # Ponder dependencies
├── ponder.config.ts              # Ponder configuration
├── ponder.schema.ts              # Database schema definition
├── tsconfig.json                 # TypeScript configuration
└── README.md                     # Detailed documentation
```

## Prerequisites

- **Docker** (for Postgres via docker-compose)
- **Node.js 20+** (required by Ponder)
- **pnpm** (workspace package manager)

## Step-by-Step Setup

### 1. Install Dependencies

From the workspace root:

```bash
pnpm install --no-frozen-lockfile
```

This installs Ponder and its dependencies:
- `@ponder/core@^0.7.0` - Ponder framework
- `viem@^2.21.53` - Ethereum library
- `@types/node@^20.11.0` - TypeScript definitions

### 2. Configure Environment

```bash
cd apps/ponder
cp .env.example .env
```

Edit `.env` if needed (defaults work for local development):

```env
# RPC endpoint for HyperEVM (chainId 999)
RPC_URL_999=https://rpc.hyperliquid.xyz/evm

# Postgres database URL
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres

# Ponder service port
PORT=42069
```

### 3. Start Postgres

From workspace root:

```bash
pnpm ponder:db
```

This starts a Postgres container via docker-compose with:
- Container: `morpho-ponder-db`
- Port: 5432
- User/Password: postgres/postgres
- Database: postgres
- Volume: `ponder-db-data` (persists data)

Verify Postgres is running:

```bash
docker ps | grep morpho-ponder-db
```

### 4. Start Ponder

From workspace root:

```bash
pnpm ponder:start
```

Or use the combined command (starts both Postgres + Ponder):

```bash
pnpm ponder:dev
```

Ponder will:
1. Connect to Postgres
2. Create database schema (market, position, vault tables)
3. Start indexing from block 0 on HyperEVM
4. Listen on http://localhost:42069

### 5. Verify Ponder is Running

In another terminal:

```bash
pnpm ponder:health
```

Expected output:
```
Checking Ponder health at http://localhost:42069...
✓ Ponder is healthy
  Status: ok
  Timestamp: 2026-01-15T...
```

### 6. Test with Morpho Bot

Now that Ponder is running, test the Morpho bot:

```bash
pnpm morpho:bot
```

Expected output:
```
[1/3] Fetching whitelisted vaults from Morpho API...
Found 19 whitelisted vaults

[2/3] Fetching markets from Ponder withdraw-queue-set...
Found X unique markets

[3/3] Fetching liquidatable positions from Ponder...
Found Y liquidatable positions
```

## Workspace Scripts Reference

All scripts can be run from the workspace root:

| Script | Description |
|--------|-------------|
| `pnpm ponder:db` | Start Postgres via docker-compose |
| `pnpm ponder:db:down` | Stop Postgres and remove container |
| `pnpm ponder:start` | Start Ponder indexer |
| `pnpm ponder:dev` | Start Postgres then Ponder (recommended) |
| `pnpm ponder:health` | Check Ponder health endpoint |
| `pnpm morpho:bot` | Run Morpho bot (requires Ponder) |

## API Endpoints

Ponder exposes these HTTP endpoints at `http://localhost:42069`:

### GET /health
Health check endpoint.

```bash
curl http://localhost:42069/health
```

Response:
```json
{ "status": "ok", "timestamp": 1705234567890 }
```

### POST /chain/:chainId/withdraw-queue-set
Fetch market IDs from vaults' withdraw queues.

```bash
curl -X POST http://localhost:42069/chain/999/withdraw-queue-set \
  -H "Content-Type: application/json" \
  -d '{"vaults":["0xe5ADd96840F0B908ddeB3Bd144C0283Ac5ca7cA0"]}'
```

Response: Array of market IDs
```json
["0x123...", "0x456..."]
```

### POST /chain/:chainId/liquidatable-positions
Fetch liquidatable positions for given markets.

```bash
curl -X POST http://localhost:42069/chain/999/liquidatable-positions \
  -H "Content-Type: application/json" \
  -d '{"marketIds":["0x123...","0x456..."]}'
```

Response:
```json
{
  "results": [
    {
      "marketId": "0x123...",
      "user": "0xabc...",
      "loanToken": "0x...",
      "collateralToken": "0x...",
      "borrowShares": "1000000000000000000n",
      "collateral": "2000000000000000000n",
      "seizableCollateral": "2000000000000000000n",
      "repaidShares": "1000000000000000000n"
    }
  ],
  "warnings": []
}
```

### GET /chain/:chainId/withdraw-queue/:address
Fetch withdraw queue for a specific vault.

```bash
curl http://localhost:42069/chain/999/withdraw-queue/0xe5ADd96840F0B908ddeB3Bd144C0283Ac5ca7cA0
```

Response: Array of market IDs
```json
["0x123...", "0x456..."]
```

## Troubleshooting

### Docker not running

```
Error: Cannot connect to the Docker daemon
```

**Solution:** Start Docker Desktop or Docker daemon:

```bash
# macOS
open -a Docker

# Linux
sudo systemctl start docker
```

### Port 5432 already in use

```
Error: Bind for 0.0.0.0:5432 failed: port is already allocated
```

**Solution:** Stop existing Postgres instance or change port in `docker-compose.yml`:

```yaml
ports:
  - "5433:5432"  # Use port 5433 on host
```

Then update `DATABASE_URL` in `.env`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres
```

### Port 42069 already in use

**Solution:** Change PORT in `.env`:

```env
PORT=42070
```

And update `PONDER_SERVICE_URL` in `apps/morpho-bot/.env`:

```env
PONDER_SERVICE_URL=http://localhost:42070
```

### RPC errors or slow indexing

```
Error: RPC request failed
```

**Solutions:**
1. Verify RPC URL is correct: `https://rpc.hyperliquid.xyz/evm`
2. Check internet connection
3. Try alternative RPC endpoint if available
4. Check HyperEVM status

### Ponder fails to start

```
Error: Cannot find module '@ponder/core'
```

**Solution:** Reinstall dependencies:

```bash
cd /path/to/liquidator
rm -rf node_modules apps/ponder/node_modules
pnpm install --no-frozen-lockfile
```

### Database schema errors

```
Error: relation "market" does not exist
```

**Solution:** Reset database:

```bash
# Stop Ponder
# Stop and remove Postgres with volumes
pnpm ponder:db:down
docker volume rm morpho-ponder-db_ponder-db-data

# Start fresh
pnpm ponder:dev
```

## Development Workflow

### Daily Development

```bash
# Terminal 1: Start Ponder
pnpm ponder:dev

# Terminal 2: Run Morpho bot
pnpm morpho:bot
```

### Viewing Logs

Ponder logs to stdout. To see detailed logs:

```env
# In apps/ponder/.env
PONDER_LOG_LEVEL=debug
```

### Stopping Services

```bash
# Stop Ponder: Ctrl+C in terminal

# Stop Postgres
pnpm ponder:db:down
```

### Resetting Database

If you need to start from scratch:

```bash
pnpm ponder:db:down
docker volume rm morpho-ponder-db_ponder-db-data
pnpm ponder:dev
```

## Configuration

### HyperEVM Chain

- **Chain ID:** 999
- **RPC:** https://rpc.hyperliquid.xyz/evm
- **Morpho Blue:** 0x68e37dE8d93d3496ae143F2E900490f6280C57cD

### Postgres

- **Host:** localhost
- **Port:** 5432
- **Database:** postgres
- **User:** postgres
- **Password:** postgres

### Ponder

- **HTTP Port:** 42069
- **Start Block:** 0 (indexes from genesis)

## Database Schema

### Tables

**market**
- Primary key: `id` (market ID bytes32)
- Fields: chainId, loanToken, collateralToken, oracle, irm, lltv, totals, lastUpdate, fee
- Index: (chainId, id)

**position**
- Primary key: `id` (composite: chainId-marketId-user)
- Fields: chainId, marketId, user, supplyShares, borrowShares, collateral
- Index: (chainId, marketId, user)

**vault**
- Primary key: `id` (composite: chainId-address)
- Fields: chainId, address, withdrawQueue (array of market IDs)
- Index: (chainId, address)

## Integration with Morpho Bot

The Morpho bot connects to Ponder via `PONDER_SERVICE_URL`:

```bash
# In apps/morpho-bot/.env
PONDER_SERVICE_URL=http://localhost:42069
```

Ensure both services are running:

1. **Start Ponder:** `pnpm ponder:dev`
2. **Verify health:** `pnpm ponder:health`
3. **Run bot:** `pnpm morpho:bot`

## Acceptance Checks

Run these commands in order to verify complete setup:

```bash
# 1. Install dependencies (may take 5-10 minutes)
pnpm install --no-frozen-lockfile

# 2. Setup Ponder environment
cp apps/ponder/.env.example apps/ponder/.env

# 3. Start Ponder (starts Postgres + Ponder)
pnpm ponder:dev

# Wait for Ponder to start indexing...
# You should see logs indicating it's syncing blocks

# 4. In another terminal, check health
pnpm ponder:health
# Expected: ✓ Ponder is healthy

# 5. Run Morpho bot (should no longer error at Ponder)
pnpm morpho:bot
# Expected: Fetches vaults, markets, positions successfully
```

## Next Steps

After Ponder is set up and running:

- **Milestone 2**: Add encoding and simulation to Morpho bot
- **Milestone 3**: Deploy executor and enable transaction sending
- **Milestone 4**: Add flashloan support

## Production Deployment

For production use:

1. Use dedicated Postgres instance (not Docker)
2. Set production `DATABASE_URL`
3. Use `ponder start` instead of `ponder dev`
4. Set up monitoring for `/health` endpoint
5. Configure log aggregation
6. Use process manager (PM2, systemd, etc.)
7. Set up alerts for indexing delays

## Additional Resources

- [Ponder Documentation](https://ponder.sh/docs)
- [Morpho Blue Documentation](https://docs.morpho.org)
- [HyperEVM Documentation](https://hyperliquid.gitbook.io)
