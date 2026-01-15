# Quick Command Reference

Essential commands for running the liquidator monorepo.

## Initial Setup (First Time Only)

```bash
# 1. Install all dependencies
pnpm install --no-frozen-lockfile

# 2. Setup Ponder environment
cp apps/ponder/.env.example apps/ponder/.env

# 3. Setup Morpho bot environment (if not done)
cp apps/morpho-bot/.env.example apps/morpho-bot/.env
```

## Daily Development

### Start Ponder (Required for Morpho bot)

```bash
# Terminal 1: Start Postgres + Ponder together
pnpm ponder:dev

# Wait for Ponder to start indexing...
# You should see logs indicating it's syncing blocks
```

### Verify Ponder is Running

```bash
# Terminal 2: Check health
pnpm ponder:health

# Expected output:
# ✓ Ponder is healthy
#   Status: ok
#   Timestamp: ...
```

### Run Morpho Bot

```bash
# Terminal 2: Run bot
pnpm morpho:bot

# Expected output:
# [1/3] Fetching whitelisted vaults from Morpho API...
# Found 19 whitelisted vaults
# [2/3] Fetching markets from Ponder withdraw-queue-set...
# Found X unique markets
# [3/3] Fetching liquidatable positions from Ponder...
# Found Y liquidatable positions
```

## Ponder Management

```bash
# Start Postgres only
pnpm ponder:db

# Stop Postgres
pnpm ponder:db:down

# Start Ponder only (assumes Postgres is running)
pnpm ponder:start

# Start both Postgres + Ponder (recommended)
pnpm ponder:dev

# Check Ponder health
pnpm ponder:health
```

## Morpho Bot

```bash
# Run Morpho bot (requires Ponder)
pnpm morpho:bot
```

## HyperLend Bot

```bash
# Run HyperLend bot
pnpm hyperlend:bot

# Deploy HyperLend contracts
pnpm hyperlend:deploy
```

## Debugging

### Check Docker Containers

```bash
# List running containers
docker ps

# Check Postgres is running
docker ps | grep morpho-ponder-db

# View Postgres logs
docker logs morpho-ponder-db

# View Postgres logs (follow)
docker logs -f morpho-ponder-db
```

### Test Ponder API Endpoints

```bash
# Health check
curl http://localhost:42069/health

# Withdraw queue set (requires vault addresses)
curl -X POST http://localhost:42069/chain/999/withdraw-queue-set \
  -H "Content-Type: application/json" \
  -d '{"vaults":["0xe5ADd96840F0B908ddeB3Bd144C0283Ac5ca7cA0"]}'

# Liquidatable positions (requires market IDs)
curl -X POST http://localhost:42069/chain/999/liquidatable-positions \
  -H "Content-Type: application/json" \
  -d '{"marketIds":[]}'
```

### Reset Database

```bash
# Stop everything
pnpm ponder:db:down

# Remove Postgres data volume
docker volume rm morpho-ponder-db_ponder-db-data

# Start fresh
pnpm ponder:dev
```

## Common Issues

### "Docker daemon not running"

```bash
# macOS
open -a Docker

# Linux
sudo systemctl start docker
```

### "Port 5432 already in use"

Edit `apps/ponder/docker-compose.yml`:
```yaml
ports:
  - "5433:5432"  # Use different host port
```

Then update `apps/ponder/.env`:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres
```

### "Port 42069 already in use"

Edit `apps/ponder/.env`:
```env
PORT=42070
```

Then update `apps/morpho-bot/.env`:
```env
PONDER_SERVICE_URL=http://localhost:42070
```

### "Failed to connect to Ponder"

```bash
# Make sure Ponder is running
pnpm ponder:dev

# Check health
pnpm ponder:health
```

### "Morpho API error: 404"

This is expected if Morpho API structure changed. The bot will show helpful errors.

### Dependencies not installing

```bash
# Clear caches and reinstall
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install --no-frozen-lockfile
```

## File Locations

```
apps/ponder/.env          # Ponder configuration
apps/morpho-bot/.env      # Morpho bot configuration
apps/hyperlend-bot/.env   # HyperLend bot configuration
```

## Logs

```bash
# Ponder logs: stdout from ponder:dev terminal
# Morpho bot logs: stdout from morpho:bot terminal
# Postgres logs: docker logs morpho-ponder-db
```

## Stopping Services

```bash
# Stop Ponder: Ctrl+C in ponder:dev terminal
# Stop Morpho bot: Ctrl+C in morpho:bot terminal
# Stop Postgres: pnpm ponder:db:down
```

## Maintenance

### Update Dependencies

```bash
pnpm update
```

### Clean Workspace

```bash
# Remove all node_modules
rm -rf node_modules apps/*/node_modules packages/*/node_modules

# Reinstall
pnpm install --no-frozen-lockfile
```

### Clean Docker

```bash
# Stop all services
pnpm ponder:db:down

# Remove volumes
docker volume rm morpho-ponder-db_ponder-db-data

# Prune unused Docker resources
docker system prune -a
```

## Getting Help

- Ponder documentation: `apps/ponder/README.md`
- Ponder setup guide: `apps/ponder/SETUP.md`
- Morpho bot docs: `apps/morpho-bot/README.md`
- Implementation summary: `PONDER-IMPLEMENTATION.md`
- Workspace README: `README.md`
