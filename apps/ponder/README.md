# Ponder Indexer for Morpho Blue

Ponder indexer for Morpho Blue on HyperEVM (chainId 999). Provides HTTP API endpoints for the Morpho liquidation bot.

## Quick Start

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Start Postgres and Ponder:**
   ```bash
   pnpm ponder:dev
   ```

3. **Verify Ponder is running:**
   ```bash
   pnpm ponder:health
   ```

## Environment Variables

Required environment variables (see `.env.example`):

- `RPC_URL_999` - RPC endpoint for HyperEVM (default: https://rpc.hyperliquid.xyz/evm)
- `DATABASE_URL` - Postgres connection string (default: postgresql://postgres:postgres@localhost:5432/postgres)
- `PORT` - Ponder service port (default: 42069)

## Available Scripts

From workspace root:

- `pnpm ponder:db` - Start Postgres via docker-compose
- `pnpm ponder:db:down` - Stop Postgres
- `pnpm ponder:start` - Start Ponder indexer
- `pnpm ponder:dev` - Start Postgres then Ponder (recommended for dev)
- `pnpm ponder:health` - Check Ponder health

From this directory:

- `pnpm dev` - Run Ponder in development mode
- `pnpm start` - Run Ponder in production mode
- `pnpm codegen` - Generate types from schema

## API Endpoints

Ponder exposes the following HTTP endpoints (default: http://localhost:42069):

### Health Check

```bash
GET /health
```

Returns:
```json
{ "status": "ok", "timestamp": 1705234567890 }
```

### Withdraw Queue Set

```bash
POST /chain/:chainId/withdraw-queue-set
```

Request body:
```json
{ "vaults": ["0x..."] }
```

Returns array of market IDs from all vaults' withdraw queues:
```json
["0x123...", "0x456..."]
```

### Liquidatable Positions

```bash
POST /chain/:chainId/liquidatable-positions
```

Request body:
```json
{ "marketIds": ["0x123...", "0x456..."] }
```

Returns:
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

### Vault Withdraw Queue

```bash
GET /chain/:chainId/withdraw-queue/:address
```

Returns array of market IDs in the vault's withdraw queue:
```json
["0x123...", "0x456..."]
```

## Architecture

```
apps/ponder/
├── abis/
│   └── MorphoBlue.json        # Morpho Blue contract ABI
├── scripts/
│   └── healthcheck.js         # Health check utility
├── src/
│   ├── index.ts               # Event handlers for indexing
│   └── api/
│       └── index.ts           # HTTP API endpoints
├── docker-compose.yml         # Postgres setup
├── ponder.config.ts           # Ponder configuration
├── ponder.schema.ts           # Database schema
├── package.json               # Dependencies
└── tsconfig.json              # TypeScript config
```

## Database Schema

### Tables

- **market** - Morpho Blue market data (chainId, id, tokens, oracle, irm, lltv, totals)
- **position** - User positions (chainId, marketId, user, supplyShares, borrowShares, collateral)
- **vault** - MetaMorpho vaults (chainId, address, withdrawQueue)

## Development

### Starting Fresh

**Important:** When upgrading Ponder major versions (e.g., 0.7 → 0.8), you **must** reset the database as the schema format changes.

```bash
# Stop and remove Postgres container and volumes
pnpm ponder:db:down

# The -v flag wipes volumes automatically
# Alternatively, manually remove the volume:
# docker volume rm morpho-ponder-db_ponder-db-data

# Start fresh
pnpm ponder:dev
```

### Checking Logs

Ponder logs to stdout. To see detailed logs, set `PONDER_LOG_LEVEL=debug` in `.env`.

### Testing with Morpho Bot

Once Ponder is running, test with the Morpho bot:

```bash
# In another terminal
pnpm morpho:bot
```

The bot should successfully fetch vaults, markets, and positions.

## Configuration

### Chain: HyperEVM

- Chain ID: 999
- RPC: https://rpc.hyperliquid.xyz/evm
- Morpho Blue: 0x68e37dE8d93d3496ae143F2E900490f6280C57cD

### Postgres

- Host: localhost
- Port: 5432
- Database: postgres
- User: postgres
- Password: postgres

Configure via `DATABASE_URL` in `.env`.

## Troubleshooting

### "Failed to connect to Ponder"

- Ensure Ponder is running: `pnpm ponder:dev`
- Check logs for errors
- Verify Postgres is running: `docker ps | grep morpho-ponder-db`

### "Postgres connection failed"

- Start Postgres: `pnpm ponder:db`
- Check `DATABASE_URL` in `.env`
- Ensure port 5432 is not in use

### "RPC error" or slow indexing

- Check `RPC_URL_999` in `.env`
- Verify RPC endpoint is accessible
- Consider using a premium RPC endpoint for faster indexing

## Integration with Morpho Bot

The Morpho bot (`apps/morpho-bot`) connects to Ponder via `PONDER_SERVICE_URL`:

```env
# In apps/morpho-bot/.env
PONDER_SERVICE_URL=http://localhost:42069
```

Ensure both services are running:

1. Start Ponder: `pnpm ponder:dev`
2. Verify health: `pnpm ponder:health`
3. Run bot: `pnpm morpho:bot`

## Production Deployment

For production:

1. Use a dedicated Postgres instance (not Docker)
2. Set production `DATABASE_URL`
3. Use `ponder start` instead of `ponder dev`
4. Set up monitoring for the `/health` endpoint
5. Consider using a load balancer if running multiple instances

## Next Steps

After Ponder is set up and running:

- **Milestone 2**: Add encoding and simulation to Morpho bot
- **Milestone 3**: Deploy executor and enable transaction sending
- **Milestone 4**: Add flashloan support

## Acceptance Checks

Run these commands in order to verify setup:

```bash
# 1. Install dependencies
pnpm -w install

# 2. Copy environment file
cp apps/ponder/.env.example apps/ponder/.env

# 3. Start Ponder (starts Postgres + Ponder)
pnpm ponder:dev

# 4. In another terminal, check health
pnpm ponder:health

# 5. Run Morpho bot (should no longer error at Ponder)
pnpm morpho:bot
```

Expected result: Bot fetches vaults, markets, and positions successfully.
