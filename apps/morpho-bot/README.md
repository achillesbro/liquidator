# Morpho Bot

Morpho Blue liquidation bot for HyperEVM (chainId 999).

## Status: Milestone 4 (Flashloan Mode)

Current implementation provides two execution modes:
- **Prefund Mode** (Milestone 3): Uses pre-funded executor with loan tokens
- **Flashloan Mode** (Milestone 4): Uses Morpho flashloans for atomic execution

Both modes include:
- Candidate discovery via Morpho Blue API (GraphQL)
- Onchain confirmation using Morpho SDK
- Swap routing via LiquidSwap API
- Simulation-first execution via Executor contracts
- Profit skim to treasury

## Prerequisites

- **Node.js 18+** (for native fetch support)
- **HyperEVM RPC** access (chainId 999)
- **Deployed Executor** contract (see Deployment section)
- For prefund mode: Executor funded with loan tokens
- For flashloan mode: No prefunding required

## Quick Start

### 1. Deploy Executor Contract

From workspace root:
```bash
# Install dependencies
pnpm install

# Compile contracts
pnpm --filter @packages/executors hardhat:compile

# Deploy prefund executor (Milestone 3)
pnpm --filter @packages/executors hardhat:deploy:morpho

# Deploy flashloan executor (Milestone 4)
pnpm --filter @packages/executors hardhat:deploy:morpho-flashloan
```

The deployment script will output the executor address. Add it to your `.env`.

### 2. Configure Environment

Create `.env` in `apps/morpho-bot/`:

```env
# Chain
CHAIN_ID=999
RPC_URL_999=https://rpc.hyperliquid.xyz/evm

# ==========================================
# EXECUTION MODE: Choose one
# ==========================================

# Option A: Flashloan Mode (Milestone 4 - recommended)
EXECUTION_MODE=flashloan
FLASHLOAN_EXECUTOR_ADDRESS_999=0x...deployed_flashloan_executor...
FLASHLOAN_BUFFER_BPS=20
# MIN_FLASHLOAN_PROFIT=1000000000000000  # Optional: min profit in loan token units
# MAX_FLASHLOAN_ASSETS=1000000000000000000  # Optional: max flashloan size

# Option B: Prefund Mode (Milestone 3)
# EXECUTION_MODE=prefund
# EXECUTOR_ADDRESS_999=0x...deployed_prefund_executor...

# ==========================================
# Common Settings (both modes)
# ==========================================
EXECUTION_ENABLED=1
LIQUIDATION_PRIVATE_KEY_999=0x...your_private_key...
TREASURY_ADDRESS=0xdA042130f265e594e3f8aF12E006F63BAD2349d3

# Safety Controls
BOT_PAUSED=false
SLIPPAGE_BPS=50
COOLDOWN_MINUTES=60
MAX_TX_PER_RUN=5
REQUIRE_ROUTE=1

# Optional: Gas limits
# MAX_GAS=1000000
# MAX_FEE_GWEI=10

# Optional: Telegram notifications
# TELEGRAM_TOKEN=your_bot_token
# TELEGRAM_CHAT_ID=your_chat_id

# Discovery settings
MAX_CANDIDATES=500
MAX_SIMULATIONS=100
```

### 3. Prepare for Execution

**Flashloan Mode** (recommended):
- No prefunding required
- Flashloan executor uses Morpho flashloans for atomic execution
- Set `EXECUTION_MODE=flashloan`
- Set `FLASHLOAN_EXECUTOR_ADDRESS_999` to your deployed flashloan executor

**Prefund Mode**:
- Transfer loan tokens to executor address
- Set `EXECUTION_MODE=prefund` (or omit, it's the default)
- Set `EXECUTOR_ADDRESS_999` to your deployed prefund executor

### 4. Run the Bot

```bash
# Dry-run flashloan mode (simulation only)
EXECUTION_ENABLED=0 EXECUTION_MODE=flashloan pnpm start

# Dry-run prefund mode (simulation only)
EXECUTION_ENABLED=0 EXECUTION_MODE=prefund pnpm start

# Live execution (flashloan)
EXECUTION_ENABLED=1 EXECUTION_MODE=flashloan pnpm start

# Live execution (prefund)
EXECUTION_ENABLED=1 EXECUTION_MODE=prefund pnpm start
```

## Execution Modes

### Flashloan Mode (Milestone 4)

Uses Morpho flashloans for atomic liquidations. No prefunding required.

**Flow**:
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

**Advantages**:
- No capital required (uses flashloans)
- Atomic execution (all-or-nothing)
- Lower risk (no stuck funds)

**Configuration**:
| Variable | Default | Description |
|----------|---------|-------------|
| `EXECUTION_MODE` | `prefund` | Set to `flashloan` |
| `FLASHLOAN_EXECUTOR_ADDRESS_999` | - | Deployed flashloan executor |
| `FLASHLOAN_BUFFER_BPS` | `20` | Buffer on flashloan amount (0.2%) |
| `MIN_FLASHLOAN_PROFIT` | `0` | Minimum profit required (in loan token units) |
| `MAX_FLASHLOAN_ASSETS` | none | Maximum flashloan size cap |
| `REQUIRE_ROUTE` | `1` | Fail if no swap route available |

### Prefund Mode (Milestone 3)

Uses pre-funded executor with loan tokens.

**Flow**:
1. Bot calls `exec_606BaXt(calls)` on executor
2. Executor executes call sequence:
   - Approve loan token → Morpho
   - Execute liquidation
   - Approve collateral → LiquidSwap
   - Swap collateral → loan token
   - Transfer profit to treasury

**Configuration**:
| Variable | Default | Description |
|----------|---------|-------------|
| `EXECUTION_MODE` | `prefund` | Default mode |
| `EXECUTOR_ADDRESS_999` | - | Deployed prefund executor |

## Environment Variables

### Required for All Modes
| Variable | Description | Example |
|----------|-------------|---------|
| `LIQUIDATION_PRIVATE_KEY_999` | Bot EOA private key (must own executor) | `0x...` |
| `TREASURY_ADDRESS` | Address to receive profits | `0xdA04...` |

### Mode-Specific
| Variable | Mode | Description |
|----------|------|-------------|
| `EXECUTION_MODE` | both | `prefund` or `flashloan` |
| `EXECUTOR_ADDRESS_999` | prefund | Prefund executor address |
| `FLASHLOAN_EXECUTOR_ADDRESS_999` | flashloan | Flashloan executor address |
| `FLASHLOAN_BUFFER_BPS` | flashloan | Flashloan buffer (default: 20) |
| `MIN_FLASHLOAN_PROFIT` | flashloan | Min profit requirement |
| `MAX_FLASHLOAN_ASSETS` | flashloan | Max flashloan cap |
| `REQUIRE_ROUTE` | flashloan | Require swap route (default: 1) |

### Safety Controls
| Variable | Default | Description |
|----------|---------|-------------|
| `EXECUTION_ENABLED` | `0` | `1` to execute, `0` for simulation only |
| `BOT_PAUSED` | `false` | Kill switch - set `true` to stop all execution |
| `SLIPPAGE_BPS` | `50` | Max slippage in basis points (50 = 0.5%) |
| `MAX_PRICE_IMPACT_PCT` | `10` | Max swap price impact in percent |
| `COOLDOWN_MINUTES` | `60` | Cooldown after failed attempt on a position |
| `MAX_TX_PER_RUN` | `5` | Max transactions per bot run |
| `MAX_REPAY_LOAN_ASSETS` | none | Max repay amount (optional cap) |

### Gas Controls (Optional)
| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_GAS` | none | Max gas limit per tx |
| `MAX_FEE_GWEI` | none | Max gas price in gwei |

### Telegram Notifications (Optional)
| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_ENABLED` | `0` | Set to `1` to enable notifications |
| `TELEGRAM_TOKEN` | - | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | `1286009814` | Chat ID for notifications |
| `TELEGRAM_SEND_ON_SENT` | `0` | Set to `1` to send notification when tx is broadcast |
| `TELEGRAM_RATE_LIMIT_SECONDS` | `30` | Minimum seconds between messages |
| `TELEGRAM_MAX_PER_HOUR` | `60` | Maximum messages per hour |

## Architecture

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
│       ├── telegram.js       # Telegram client with rate limiting
│       ├── telegramFormat.js # Telegram message formatting
│       ├── report.js         # CLI output formatter
│       └── retry.js          # HTTP retry utility
├── package.json
├── .env.example
└── README.md

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
├── deployments/
│   └── hyperEvm.json           # Deployment info
├── hardhat.config.js
└── package.json
```

## Execution Flow

1. **Discovery**: Fetch vaults → markets → candidate positions from Morpho API
2. **Confirmation**: Verify positions are liquidatable onchain using SDK
3. **Filtering**: Apply cooldowns, caps, and other operational filters
4. **Routing**: Get swap routes from LiquidSwap for collateral → loan token
5. **Simulation**: Simulate full execution via appropriate executor
6. **Execution**: If profitable and enabled, execute via selected mode

### Flashloan Mode Call Sequence

```
FlashloanExecutor.flash_606BaXt(token, assets, calls, treasury, minProfit)
  └─> morpho.flashLoan(token, assets, callbackData)
        └─> FlashloanExecutor.onMorphoFlashLoan(assets, data)
              ├── ERC20.approve(Morpho, repayAmount)
              ├── Morpho.liquidate(params, borrower, seize, repay, "0x")
              ├── ERC20.approve(LiquidSwap, seizeAmount)
              ├── LiquidSwap.executeSwaps(...)
              ├── ERC20.approve(Morpho, assets)  # For flashloan repayment
              └── ERC20.transfer(treasury, profit)
        └─> Morpho pulls repayment
```

### Prefund Mode Call Sequence

```
Executor.exec_606BaXt([
  1. ERC20.approve(Morpho, repayAmount)     # Allow Morpho to take loan tokens
  2. Morpho.liquidate(params, borrower, seize, repay, "0x")  # Execute liquidation
  3. ERC20.approve(LiquidSwap, seizeAmount) # Allow router to take collateral
  4. LiquidSwap.executeSwaps(...)           # Swap collateral → loan token
  5. ERC20.transfer(treasury, profit)       # Skim profit to treasury
])
```

## Constants (HyperEVM)

| Contract | Address |
|----------|---------|
| Chain ID | `999` |
| Morpho Blue | `0x68e37dE8d93d3496ae143F2E900490f6280C57cD` |
| WHYPE (wNative) | `0x5555555555555555555555555555555555555555` |
| Treasury | `0xdA042130f265e594e3f8aF12E006F63BAD2349d3` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| LiquidSwap Router | `0x744489ee3d540777a66f2cf297479745e0852f7a` |

## Safety Checklist

### For Both Modes
- [ ] Executor contract deployed and verified
- [ ] Bot EOA is owner of executor
- [ ] Treasury address is correct
- [ ] Slippage settings are appropriate
- [ ] Gas limits configured (optional but recommended)
- [ ] Cooldown settings are appropriate
- [ ] Test with `EXECUTION_ENABLED=0` first

### Additional for Flashloan Mode
- [ ] Flashloan executor has correct Morpho address
- [ ] `FLASHLOAN_BUFFER_BPS` is set appropriately (default: 20)
- [ ] `REQUIRE_ROUTE=1` to prevent execution without swap route

### Additional for Prefund Mode
- [ ] Executor funded with sufficient loan tokens

## Troubleshooting

### "FLASHLOAN_EXECUTOR_ADDRESS_999 is required"
Set the flashloan executor address in your `.env` when `EXECUTION_MODE=flashloan`.

### "EXECUTOR_ADDRESS_999 is required"
Set the executor address in your `.env` when `EXECUTION_MODE=prefund`.

### "Flashloan executor verification failed"
Check that:
- Bot EOA is owner of the flashloan executor
- Flashloan executor has correct Morpho Blue address configured

### "Bot account is not owner of executor"
The private key must correspond to the address that deployed/owns the executor.

### "InsufficientProfit" revert
The flashloan execution didn't generate enough profit. Check:
- Swap route is available and returns expected output
- `MIN_FLASHLOAN_PROFIT` isn't set too high
- Slippage settings allow profitable execution

### "Simulation failed"
Check the revert reason. Common causes:
- Position no longer liquidatable (already liquidated or repaid)
- Insufficient collateral value
- Oracle price issues
- Swap route not profitable

### "Gas price exceeds limit"
Network is congested. Wait or increase `MAX_FEE_GWEI`.

## Telegram Alerts

The bot can send Telegram notifications for liquidation events. Configure via environment variables:

### Setup

1. **Create a Telegram bot**:
   - Message [@BotFather](https://t.me/BotFather) on Telegram
   - Use `/newbot` command and follow instructions
   - Save the bot token

2. **Get your chat ID**:
   - Start a chat with your bot
   - Send a message to your bot
   - Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   - Find your chat ID in the response (or use the default: `1286009814`)

3. **Configure environment variables**:
   ```env
   TELEGRAM_ENABLED=1
   TELEGRAM_TOKEN=your_bot_token_here
   TELEGRAM_CHAT_ID=1286009814
   TELEGRAM_SEND_ON_SENT=0  # Optional: send when tx is broadcast
   TELEGRAM_RATE_LIMIT_SECONDS=30  # Optional: min seconds between messages
   TELEGRAM_MAX_PER_HOUR=60  # Optional: max messages per hour
   ```

### Notification Events

- **Bot Start**: Sent once when bot starts (if `TELEGRAM_ENABLED=1`)
- **Bot Stop**: Sent once when bot stops gracefully (SIGINT/SIGTERM)
- **Transaction Sent** (optional): Sent when liquidation tx is broadcast (if `TELEGRAM_SEND_ON_SENT=1`)
- **Success**: Sent when liquidation tx is confirmed successfully
- **Failure**: Sent when liquidation tx fails (revert, dropped, timeout)

### Rate Limiting & Deduplication

- **Deduplication**: Messages are deduplicated by transaction hash (6-hour TTL)
- **Rate Limiting**: 
  - No more than 1 message per `TELEGRAM_RATE_LIMIT_SECONDS` (default: 30s)
  - No more than `TELEGRAM_MAX_PER_HOUR` per hour (default: 60)
- **Silent Failures**: If rate-limited or API errors occur, messages are dropped silently (no crash)

### Safety

- Bot token is never logged or printed
- Default chat ID is `1286009814` (as specified)
- If `TELEGRAM_ENABLED=0` or token/chat ID missing, all Telegram calls are no-ops

## Milestones

- **Milestone 1**: Data flow plumbing (vaults → markets → positions)
- **Milestone 2**: SDK confirmation + simulation + profitability gating
- **Milestone 3**: ✅ Execution via Executor (prefunded mode)
- **Milestone 4**: ✅ Morpho flashloan mode (atomic execution)
