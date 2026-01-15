# Liquidator Monorepo

Monorepo for liquidation bots supporting multiple protocols (HyperLend, Morpho Blue).

## Workspace Structure

```
liquidator/
├── apps/
│   ├── hyperlend-bot/    # HyperLend Isolated Pair liquidation bot
│   ├── morpho-bot/       # Morpho Blue liquidation bot (Milestone 4)
│   └── ponder/           # Ponder indexer for Morpho Blue (Ponder 0.8+)
├── packages/
│   ├── core/             # Shared utilities (currently empty)
│   └── executors/        # Liquidation executor contracts
│       ├── contracts/
│       │   ├── IsolatedLiquidator.sol          # HyperLend executor
│       │   └── morpho/
│       │       ├── Executor606BaXt.sol                  # Morpho prefund executor
│       │       └── MorphoFlashloanExecutor606BaXt.sol   # Morpho flashloan executor
│       └── scripts/
│           ├── deploy.js                        # Deploy HyperLend executors
│           ├── deploy_morpho_executor.js        # Deploy Morpho prefund executor
│           └── deploy_morpho_flashloan_executor.js  # Deploy Morpho flashloan executor
└── pnpm-workspace.yaml
```

## Installation

```bash
pnpm install
```

## Quick Start

### Morpho Bot

**Status: Milestone 4 Complete** ✅

The Morpho bot supports two execution modes:
- **Prefund Mode** (Milestone 3): Uses pre-funded executor with loan tokens
- **Flashloan Mode** (Milestone 4): Uses Morpho flashloans for atomic execution

**Prerequisites:**
- Node.js 18+
- HyperEVM RPC access (chainId 999)
- Deployed executor contract (see Deployment section)

**Quick Start:**

1. **Deploy Executor:**
   ```bash
   # Deploy flashloan executor (recommended)
   pnpm --filter @packages/executors hardhat:deploy:morpho-flashloan
   
   # Or deploy prefund executor
   pnpm --filter @packages/executors hardhat:deploy:morpho
   ```

2. **Configure Environment:**
   ```bash
   cd apps/morpho-bot
   cp .env.example .env
   # Edit .env with your executor address and private key
   ```

3. **Run Bot:**
   ```bash
   # Dry-run (simulation only)
   EXECUTION_ENABLED=0 pnpm morpho:bot
   
   # Live execution
   EXECUTION_ENABLED=1 pnpm morpho:bot
   ```

See `apps/morpho-bot/README.md` for detailed documentation.

### HyperLend Bot

**Status: Production Ready** ✅

Liquidation bot for HyperLend Isolated Pairs using Core Pool flashloans and UniV3 swaps.

**Quick Start:**

1. **Deploy Contracts:**
   ```bash
   pnpm hyperlend:deploy
   ```

2. **Configure Environment:**
   ```bash
   cd apps/hyperlend-bot
   # Create .env with RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS_*, etc.
   ```

3. **Run Bot:**
   ```bash
   pnpm hyperlend:bot
   ```

See HyperLend Bot section below for detailed documentation.

### Ponder Indexer

**Status: Upgraded to Ponder 0.8** ✅

Ponder indexer for Morpho Blue on HyperEVM. Provides HTTP API endpoints for the Morpho liquidation bot.

**Quick Start:**

1. **Start Ponder:**
   ```bash
   pnpm ponder:dev
   ```

2. **Verify Health:**
   ```bash
   pnpm ponder:health
   ```

3. **Use with Morpho Bot:**
   The Morpho bot can optionally use Ponder for candidate discovery, but it also works standalone via Morpho API.

See `apps/ponder/README.md` for detailed documentation.

## Available Scripts

From workspace root:

| Command | Description |
|---------|-------------|
| `pnpm hyperlend:bot` | Run HyperLend liquidation bot |
| `pnpm hyperlend:deploy` | Deploy HyperLend executor contracts |
| `pnpm morpho:bot` | Run Morpho liquidation bot |
| `pnpm morpho:bot:dry` | Run Morpho bot in simulation-only mode |
| `pnpm morpho:bot:exec` | Run Morpho bot with execution enabled |
| `pnpm morpho:deploy` | Deploy Morpho prefund executor |
| `pnpm ponder:db` | Start Postgres via docker-compose |
| `pnpm ponder:db:down` | Stop Postgres |
| `pnpm ponder:start` | Start Ponder indexer |
| `pnpm ponder:dev` | Start Postgres + Ponder together |
| `pnpm ponder:health` | Check Ponder health |

## HyperLend Isolated Pair Liquidator

Liquidation bot for HyperLend Isolated Pairs using Core Pool flashloans and ProjectX/HyperSwap swaps.

### Architecture

**Flow:**
1. **Core Pool Flashloan**: Borrow asset token (USDC/USDT0) from HyperLend Core Pool
2. **Isolated Pair Liquidation**: Liquidate isolated pair position (e.g. xHYPE/USDC or wHLP/USDT0)
3. **UniV3 Swap**: Swap seized collateral to asset token via UniV3-compatible router (ProjectX or HyperSwap)
4. **Repay Flashloan**: Repay borrowed asset token + premium
5. **Profit**: Remaining asset tokens stay in contract, extracted via rescue script

### Contracts

- **IsolatedLiquidator.sol**: Main liquidation contract (supports multiple markets via deployment config)
  - Uses `flashLoanSimple` from Core Pool
  - Calls `pair.liquidate()` on isolated pair
  - Swaps via UniV3-compatible router `exactInputSingle` (ProjectX or HyperSwap)
  - Emits `LiquidationExecuted` event with profit details
  - Two deployed instances: one for XHYPE/USDC, one for WHLP/USDT0

### Bot

- **index.js**: Main bot loop (cron every 10 seconds)
  - Processes multiple markets (XHYPE/USDC and WHLP/USDT0)
  - Loads market-specific candidates from `candidates.<marketId>.json`
  - Batches snapshots and borrow amounts via multicall
  - Computes liquidatability using market-specific oracle bands and decimals
  - Simulates transactions via `eth_call` before sending
  - Sends Telegram notifications on successful liquidations
  - Rescues profit to configured address

### Configuration

**Chain:**
- Network: HyperEVM
- ChainId: 999
- RPC: https://rpc.hyperliquid.xyz/evm

**Addresses:**

#### Core Pool (shared)
- Core Pool: `0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b`

#### XHYPE/USDC Market
- Pair: `0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd`
- Collateral (xHYPE): `0xAc962FA04BF91B7fd0DC0c5C32414E0Ce3C51E03`
- Asset (USDC): `0xb88339CB7199b77E23DB6E890353E22632Ba630f`
- Oracle: `0x896970EB7FB914eFcDfaDA4CFFC3E3C31497Da5a`
- Router (ProjectX): `0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B`
- Quoter (ProjectX): `0x239F11a7A3E08f2B8110D4CA9F6B95d4c8865258`
- Pool: `0x6a76bd79bd97ffe55eb87c701f9ae8a1e3d7254e`
- Fee: 100 (0.01%)

#### WHLP/USDT0 Market
- Pair: `0x06Fd9D03b3d0F18E4919919b72D30c582f0a97E5`
- Collateral (wHLP): `0x1359b05241cA5076c9F59605214f4F84114c0dE8`
- Asset (USDT0): `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb`
- Oracle: `0xE0d0528707a5dc63329EC4993f58E35D77AE4eD0`
- Router (HyperSwap Router02): `0x6D99e7f6747AF2cDbB5164b6DD50e40D4fDe1e77`
- Quoter (HyperSwap QuoterV2): `0x03A918028f22D9E1473B7959C927AD7425A45C7C`
- Pool: `0x859235541c19a3b26436fe7ecddf22142d8dccae`
- Fee: 100 (0.01%)

### Environment Variables

**Bot (.env in `apps/hyperlend-bot/` directory):**

```bash
# RPC Configuration
RPC_URL=https://rpc.hyperliquid.xyz/evm

# Wallet Configuration
PRIVATE_KEY=0x...  # Private key of the wallet that will send transactions

# Contract Configuration (per market)
CONTRACT_ADDRESS_XHYPE_USDC=0x...  # Deployed IsolatedLiquidator contract address for XHYPE/USDC
CONTRACT_ADDRESS_WHLP_USDT0=0x...  # Deployed IsolatedLiquidator contract address for WHLP/USDT0

# Profit Configuration
PROFIT_RECEIVER=0x...  # Address to receive rescued profits

# Liquidation Parameters
MAX_REPAY_USDC=2000000  # Maximum USDC to repay per liquidation (in 6 decimals)
SLIPPAGE_BPS=50  # Slippage tolerance in basis points (50 = 0.5%)

# Telegram Notifications (optional)
TELEGRAM_TOKEN=  # Telegram bot token (leave empty if not using)
TELEGRAM_CHAT_ID=  # Telegram chat ID (leave empty if not using)

# Bot Control
BOT_PAUSED=false  # Set to 'true' to pause the bot (kill switch)
```

**Contracts (.env in `packages/executors/` directory):**

For deployment scripts:

```bash
PRIVATE_KEY_MAINNET=0x...  # Private key for deployment (used by Hardhat)
```

### Deployment

The deploy script deploys two contract instances (one for each market) in a single run:

```bash
pnpm hyperlend:deploy
```

Or from the executors directory:
```bash
cd packages/executors
npx hardhat run scripts/deploy.js --network hyperEvm
```

The script will deploy:
1. **XHYPE/USDC liquidator** using ProjectX router (fee=100)
2. **WHLP/USDT0 liquidator** using HyperSwap Router02 (fee read from pool or default 100)

Both contract addresses will be printed to the console. See `packages/executors/README.md` for environment variable configuration options.

### Running the Bot

```bash
pnpm hyperlend:bot
```

Or from the app directory:
```bash
cd apps/hyperlend-bot
pnpm start
```

### Rescue Script

Extract profit from contract:

```bash
cd packages/executors
CONTRACT_ADDRESS=0x... PROFIT_RECEIVER=0x... npx hardhat run scripts/rescue.js --network hyperEvm
```

Or use the pnpm script:
```bash
CONTRACT_ADDRESS=0x... PROFIT_RECEIVER=0x... pnpm --filter @packages/executors hardhat:rescue
```

### Safety Features

- **Simulation**: All transactions are simulated via `eth_call` before sending
- **Slippage Protection**: Configurable slippage tolerance (default 0.5%)
- **Deadline Enforcement**: Tight deadlines (block.timestamp + 2)
- **Conservative Caps**: MAX_REPAY_USDC limits liquidation size
- **Retry Logic**: Per-borrower retry tracking with backoff
- **Kill Switch**: BOT_PAUSED env var to pause bot
- **Exact Approvals**: Approvals limited to exact amounts, not max

### Candidate Sources

1. **HyperLend API** (preferred, TODO: implement endpoint)
2. **candidates.json** (fallback: array of borrower addresses)

## Morpho Blue Liquidator

Morpho Blue liquidation bot for HyperEVM (chainId 999). Supports both prefund and flashloan execution modes.

### Status

- **Milestone 1**: ✅ Data flow plumbing (vaults → markets → positions)
- **Milestone 2**: ✅ SDK confirmation + simulation + profitability gating
- **Milestone 3**: ✅ Execution via Executor (prefunded mode)
- **Milestone 4**: ✅ Morpho flashloan mode (atomic execution)

### Execution Modes

#### Flashloan Mode (Milestone 4 - Recommended)

Uses Morpho flashloans for atomic liquidations. No prefunding required.

**Flow:**
1. Bot initiates `flash_606BaXt(token, assets, calls, treasury, minProfit)` on executor
2. Executor calls `morpho.flashLoan(token, assets, callbackData)`
3. Morpho transfers flashloan to executor and calls `onMorphoFlashLoan`
4. Inside callback, executor:
   - Approves Morpho for liquidation repayment
   - Executes liquidation (receives collateral)
   - Approves and swaps collateral → loan token via LiquidSwap
   - Approves Morpho to pull flashloan repayment
   - Transfers profit to treasury
5. Morpho pulls repayment
6. Transaction completes atomically

**Advantages:**
- No capital required (uses flashloans)
- Atomic execution (all-or-nothing)
- Lower risk (no stuck funds)

#### Prefund Mode (Milestone 3)

Uses pre-funded executor with loan tokens.

**Flow:**
1. Bot calls `exec_606BaXt(calls)` on executor
2. Executor executes call sequence:
   - Approve loan token → Morpho
   - Execute liquidation
   - Approve collateral → LiquidSwap
   - Swap collateral → loan token
   - Transfer profit to treasury

### Architecture

```
apps/morpho-bot/
├── src/
│   ├── index.js              # Main entry point
│   └── lib/
│       ├── env.js            # Environment config loader
│       ├── morphoApi.js      # Morpho API client
│       ├── candidateSource.js # Candidate discovery
│       ├── sdkConfirm.js     # SDK-based confirmation
│       ├── routeLiquidSwap.js # LiquidSwap routing
│       ├── encodePlan.js     # Call encoding (prefund + flashloan)
│       ├── simulate.js       # Simulation logic
│       ├── execute.js        # Execution dispatcher (prefund + flashloan)
│       ├── operations.js     # Cooldowns, caps, notifications
│       ├── report.js         # CLI output formatter
│       └── retry.js          # HTTP retry utility

packages/executors/
├── contracts/
│   ├── interfaces/
│   │   └── IMorpho.sol              # Morpho interface
│   └── morpho/
│       ├── Executor606BaXt.sol                  # Prefund executor
│       └── MorphoFlashloanExecutor606BaXt.sol   # Flashloan executor
├── scripts/
│   ├── deploy_morpho_executor.js           # Deploy prefund executor
│   └── deploy_morpho_flashloan_executor.js # Deploy flashloan executor
```

### Execution Flow

1. **Discovery**: Fetch vaults → markets → candidate positions from Morpho API
2. **Confirmation**: Verify positions are liquidatable onchain using SDK
3. **Filtering**: Apply cooldowns, caps, and other operational filters
4. **Routing**: Get swap routes from LiquidSwap for collateral → loan token
5. **Simulation**: Simulate full execution via appropriate executor
6. **Execution**: If profitable and enabled, execute via selected mode

### Environment Variables

**Required for All Modes:**
```env
LIQUIDATION_PRIVATE_KEY_999=0x...  # Bot EOA private key (must own executor)
TREASURY_ADDRESS=0xdA042130f265e594e3f8aF12E006F63BAD2349d3
```

**Mode Selection:**
```env
# Flashloan Mode (recommended)
EXECUTION_MODE=flashloan
FLASHLOAN_EXECUTOR_ADDRESS_999=0x...deployed_flashloan_executor...
FLASHLOAN_BUFFER_BPS=20

# Prefund Mode
EXECUTION_MODE=prefund
EXECUTOR_ADDRESS_999=0x...deployed_prefund_executor...
```

**Safety Controls:**
```env
EXECUTION_ENABLED=0  # 1 to execute, 0 for simulation only
BOT_PAUSED=false    # Kill switch
SLIPPAGE_BPS=50     # Max slippage in basis points
COOLDOWN_MINUTES=60 # Cooldown after failed attempt
MAX_TX_PER_RUN=5    # Max transactions per bot run
REQUIRE_ROUTE=1      # Fail if no swap route available
```

See `apps/morpho-bot/README.md` for complete environment variable documentation.

### Constants (HyperEVM)

| Contract | Address |
|----------|---------|
| Chain ID | `999` |
| Morpho Blue | `0x68e37dE8d93d3496ae143F2E900490f6280C57cD` |
| WHYPE (wNative) | `0x5555555555555555555555555555555555555555` |
| Treasury | `0xdA042130f265e594e3f8aF12E006F63BAD2349d3` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| LiquidSwap Router | `0x744489ee3d540777a66f2cf297479745e0852f7a` |

### Deployment

**Deploy Flashloan Executor (Recommended):**
```bash
pnpm --filter @packages/executors hardhat:deploy:morpho-flashloan
```

**Deploy Prefund Executor:**
```bash
pnpm --filter @packages/executors hardhat:deploy:morpho
```

The deployment script will output the executor address. Add it to your `.env`.

### Running the Bot

```bash
# Dry-run (simulation only)
EXECUTION_ENABLED=0 pnpm morpho:bot

# Live execution (flashloan mode)
EXECUTION_ENABLED=1 EXECUTION_MODE=flashloan pnpm morpho:bot

# Live execution (prefund mode)
EXECUTION_ENABLED=1 EXECUTION_MODE=prefund pnpm morpho:bot
```

See `apps/morpho-bot/README.md` for detailed documentation.

## Ponder Indexer

Ponder indexer for Morpho Blue on HyperEVM (chainId 999). Provides HTTP API endpoints for the Morpho liquidation bot.

### Status

**Upgraded to Ponder 0.8** ✅

Ponder infrastructure is set up and working. The Morpho bot can optionally use Ponder for candidate discovery, but it also works standalone via Morpho API.

### Quick Start

1. **Start Postgres and Ponder:**
   ```bash
   pnpm ponder:dev
   ```

2. **Verify Health:**
   ```bash
   pnpm ponder:health
   ```

3. **Use with Morpho Bot:**
   The Morpho bot can use Ponder by setting `PONDER_SERVICE_URL` in `.env`, but it's optional since the bot also works via Morpho API.

### API Endpoints

- **GET /health** - Health check
- **POST /chain/:chainId/withdraw-queue-set** - Get markets from vaults' withdraw queues
- **POST /chain/:chainId/liquidatable-positions** - Get liquidatable positions for markets
- **GET /chain/:chainId/withdraw-queue/:address** - Get withdraw queue for a vault

See `apps/ponder/README.md` for detailed documentation.

## Development

### Workspace Management

This is a pnpm workspace monorepo. All packages are managed from the root:

```bash
# Install all dependencies
pnpm install

# Run scripts from workspace root
pnpm morpho:bot
pnpm hyperlend:bot

# Run scripts in specific package
pnpm --filter @apps/morpho-bot start
pnpm --filter @packages/executors hardhat:compile
```

### Project Structure

- **apps/**: Application packages (bots, indexers)
- **packages/**: Shared packages (contracts, utilities)
- **pnpm-workspace.yaml**: Workspace configuration

### Common Commands

See `QUICK-COMMANDS.md` for a quick reference of essential commands.

## Troubleshooting

### Morpho Bot

- **"FLASHLOAN_EXECUTOR_ADDRESS_999 is required"**: Set the flashloan executor address in `.env` when `EXECUTION_MODE=flashloan`
- **"Bot account is not owner of executor"**: The private key must correspond to the address that deployed/owns the executor
- **"InsufficientProfit" revert**: Check swap route availability and profit calculations
- **"Simulation failed"**: Position may no longer be liquidatable, or swap route not profitable

### HyperLend Bot

- **"No CONTRACT_ADDRESS_* set"**: Configure contract addresses per market in `.env`
- **"Simulation failed"**: Position may no longer be liquidatable, or slippage too tight

### Ponder

- **"Failed to connect to Ponder"**: Ensure Ponder is running: `pnpm ponder:dev`
- **"Postgres connection failed"**: Start Postgres: `pnpm ponder:db`
- **Port conflicts**: Change ports in `docker-compose.yml` and `.env` files

## Documentation

- **Morpho Bot**: `apps/morpho-bot/README.md` - Complete Morpho bot documentation
- **HyperLend Bot**: See HyperLend Bot section above
- **Ponder**: `apps/ponder/README.md` - Ponder indexer documentation
- **Executors**: `packages/executors/README.md` - Contract deployment documentation
- **Quick Commands**: `QUICK-COMMANDS.md` - Quick reference for common commands

## License

ISC
