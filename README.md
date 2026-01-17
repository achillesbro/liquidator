# Liquidator Monorepo

Monorepo for liquidation bots supporting multiple protocols (HyperLend, Morpho Blue) on HyperEVM.

## Installation

```bash
pnpm install
```

## Quick Start

### Morpho Bot

Liquidation bot for Morpho Blue with three execution modes:
- **Flashloan V2 Mode** (recommended): HYPE-denominated profits, gas-aware profitability
- **Flashloan V1 Mode**: Loan token profits
- **Prefund Mode**: Uses pre-funded executor with loan tokens

```bash
# 1. Deploy V2 executor (recommended)
cd packages/executors
pnpm hardhat run scripts/deploy_morpho_flashloan_executor_v2.js --network hyperEvm

# 2. Configure environment
cd apps/morpho-bot && cp .env.example .env
# Edit .env with executor address and private key

# 3. Run bot
EXECUTION_ENABLED=0 pnpm morpho:bot  # Dry-run
EXECUTION_ENABLED=1 pnpm morpho:bot  # Live execution
```

See [`apps/morpho-bot/README.md`](apps/morpho-bot/README.md) for detailed documentation.

### HyperLend Bot

**Status: WIP** ⚠️

Liquidation bot for HyperLend Isolated Pairs using Core Pool flashloans and UniV3 swaps.

```bash
# 1. Deploy contracts
pnpm hyperlend:deploy

# 2. Configure environment
cd apps/hyperlend-bot
# Create .env with RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS_*, etc.

# 3. Run bot
pnpm hyperlend:bot
```

### Ponder Indexer

**Status: WIP** ⚠️

Ponder indexer for Morpho Blue on HyperEVM. **Note:** Likely not needed as Morpho bot works standalone via Morpho API.

```bash
pnpm ponder:dev
```

See [`apps/ponder/README.md`](apps/ponder/README.md) for details.

## Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm morpho:bot` | Run Morpho liquidation bot |
| `pnpm morpho:bot:dry` | Run Morpho bot (simulation only) |
| `pnpm morpho:bot:exec` | Run Morpho bot (execution enabled) |
| `pnpm hyperlend:bot` | Run HyperLend liquidation bot |
| `pnpm hyperlend:deploy` | Deploy HyperLend executor contracts |
| `pnpm morpho:deploy` | Deploy Morpho prefund executor |
| `pnpm ponder:dev` | Start Postgres + Ponder indexer |

## Architecture

### Morpho Bot

- **Discovery**: Fetches liquidatable positions from Morpho API
- **Confirmation**: Validates positions onchain using Morpho SDK
- **Routing**: Gets swap routes from LiquidSwap API (collateral → loan token)
- **Profit Quoting** (V2): Gets profit routes from Project X (loan token → HYPE)
- **Execution**: Executes liquidations via executor contracts (flashloan V1/V2 or prefund mode)

### HyperLend Bot

- **Flashloan**: Borrows asset tokens from Core Pool
- **Liquidation**: Liquidates isolated pair positions
- **Swap**: Swaps collateral to asset token via UniV3 router
- **Profit**: Extracted via rescue script

## Project Structure

```
liquidator/
├── apps/
│   ├── morpho-bot/       # Morpho Blue liquidation bot
│   ├── hyperlend-bot/    # HyperLend liquidation bot (WIP)
│   └── ponder/           # Ponder indexer (WIP)
└── packages/
    └── executors/        # Liquidation executor contracts
```

## Documentation

- **Morpho Bot**: [`apps/morpho-bot/README.md`](apps/morpho-bot/README.md)
- **HyperLend Bot**: See `apps/hyperlend-bot/` directory
- **Ponder**: [`apps/ponder/README.md`](apps/ponder/README.md)
- **Executors**: [`packages/executors/README.md`](packages/executors/README.md)

## License

ISC
