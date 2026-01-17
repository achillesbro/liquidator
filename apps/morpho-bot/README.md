# Morpho Bot

Morpho Blue liquidation bot for HyperEVM (chainId 999).

## Status: Milestone 5 (HYPE-Denominated Profits)

Current implementation provides three execution modes:
- **Flashloan V2 Mode** (Milestone 5, recommended): HYPE-denominated profits with gas-aware profitability check
- **Flashloan V1 Mode** (Milestone 4): Loan token profits
- **Prefund Mode** (Milestone 3): Uses pre-funded executor with loan tokens

All modes include:
- Candidate discovery via Morpho Blue API (GraphQL)
- Onchain confirmation using Morpho SDK
- Swap routing via LiquidSwap API (collateral → loan token)
- Simulation-first execution via Executor contracts
- Profit skim to treasury

**V2 Mode additionally includes:**
- Profit swap via Project X (loan token → WHYPE → HYPE)
- Direct HYPE profit vs HYPE gas cost comparison
- Native HYPE sent to treasury

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

# Deploy flashloan V2 executor (Milestone 5 - recommended)
pnpm --filter @packages/executors hardhat run scripts/deploy_morpho_flashloan_executor_v2.js --network hyperEvm

# Or deploy flashloan V1 executor (Milestone 4)
pnpm --filter @packages/executors hardhat:deploy:morpho-flashloan

# Or deploy prefund executor (Milestone 3)
pnpm --filter @packages/executors hardhat:deploy:morpho
```

The deployment script will output the executor address. Add it to your `.env`.

### 2. Configure Environment

Create `.env` in `apps/morpho-bot/`:

```env
# Chain
CHAIN_ID=999
RPC_URL_999=https://rpc.hyperliquid.xyz/evm

# ==========================================
# EXECUTION MODE
# ==========================================
EXECUTION_MODE=flashloan

# ==========================================
# EXECUTOR CONTRACTS
# ==========================================

# V2 Executor (HYPE profits - recommended)
FLASHLOAN_EXECUTOR_V2_ADDRESS_999=0x51C6d213a8A9103ad795596EB28070F7ff525B4e
USE_EXECUTOR_V2=1

# V1 Executor (loan token profits - fallback)
FLASHLOAN_EXECUTOR_ADDRESS_999=0x98FCe9e656DBc832B2e2392a3fE188f7518CC234

# Flashloan buffer (100% = 10000 bps)
FLASHLOAN_BUFFER_BPS=10000

# ==========================================
# Project X (V2 profit swap)
# ==========================================
PRJX_ROUTER_ADDRESS=0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B
PRJX_QUOTER_ADDRESS=0x51f82BCf0785EB8E2297e02F36AB38aca23eb0c6
PROFIT_SLIPPAGE_BPS=100

# ==========================================
# Common Settings
# ==========================================
EXECUTION_ENABLED=1
LIQUIDATION_PRIVATE_KEY_999=your_private_key_no_0x_prefix
TREASURY_ADDRESS=0xdA042130f265e594e3f8aF12E006F63BAD2349d3

# Safety Controls
BOT_PAUSED=false
SLIPPAGE_BPS=50
MAX_PRICE_IMPACT_PCT=10

# Per-tick limits
CANDIDATES_PER_TICK=400
MAX_SIMULATIONS_PER_TICK=75
MAX_TX_PER_TICK=2

# Optional: Telegram notifications
# TELEGRAM_ENABLED=1
# TELEGRAM_TOKEN=your_bot_token
# TELEGRAM_CHAT_ID=your_chat_id
```

### 3. Prepare for Execution

**Flashloan V2 Mode** (recommended):
- No prefunding required
- Profits converted to HYPE and compared against gas cost
- Set `EXECUTION_MODE=flashloan` and `USE_EXECUTOR_V2=1`
- Set `FLASHLOAN_EXECUTOR_V2_ADDRESS_999` to your deployed V2 executor

**Flashloan V1 Mode**:
- No prefunding required
- Profits kept in loan token
- Set `EXECUTION_MODE=flashloan` and `USE_EXECUTOR_V2=0`
- Set `FLASHLOAN_EXECUTOR_ADDRESS_999` to your deployed V1 executor

**Prefund Mode**:
- Transfer loan tokens to executor address
- Set `EXECUTION_MODE=prefund`
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

### Flashloan V2 Mode (Milestone 5 - Recommended)

Uses Morpho flashloans with HYPE-denominated profit handling. No prefunding required.

**Flow**:
1. Bot initiates `flashV2(token, assets, calls, treasury, profitSwapParams, skipProfitSwap)` on V2 executor
2. Executor calls `morpho.flashLoan(token, assets, callbackData)`
3. Morpho transfers flashloan to executor and calls `onMorphoFlashLoan`
4. Inside callback, executor:
   - Executes call plan (liquidation + collateral → loan token swap)
   - Repays flashloan to Morpho
   - Swaps loan token profit → WHYPE via Project X
   - Unwraps WHYPE → HYPE
   - Sends native HYPE to treasury
5. Transaction completes atomically

**Advantages**:
- No capital required (uses flashloans)
- Atomic execution (all-or-nothing)
- HYPE profit enables direct comparison with gas cost
- Gas-aware profitability check

**Configuration**:
| Variable | Default | Description |
|----------|---------|-------------|
| `EXECUTION_MODE` | `flashloan` | Must be `flashloan` |
| `USE_EXECUTOR_V2` | `0` | Set to `1` for V2 |
| `FLASHLOAN_EXECUTOR_V2_ADDRESS_999` | - | Deployed V2 executor |
| `FLASHLOAN_BUFFER_BPS` | `10000` | Buffer on flashloan (100% for safety) |
| `PRJX_ROUTER_ADDRESS` | `0x1EbD...` | Project X router for profit swap |
| `PRJX_QUOTER_ADDRESS` | `0x51f8...` | Project X quoter for profit quoting |
| `PROFIT_SLIPPAGE_BPS` | `100` | Slippage for profit swap (1%) |

### Flashloan V1 Mode (Milestone 4)

Uses Morpho flashloans for atomic liquidations. Profits kept in loan token.

**Flow**:
1. Bot initiates `flash_606BaXt(token, assets, calls, treasury, minProfit)` on executor
2. Executor calls `morpho.flashLoan(token, assets, callbackData)`
3. Morpho transfers flashloan to executor and calls `onMorphoFlashLoan`
4. Inside callback, executor:
   - Approves Morpho for liquidation repayment
   - Executes liquidation (receives collateral)
   - Approves and swaps collateral → loan token via LiquidSwap
   - Approves Morpho to pull flashloan repayment
   - Transfers loan token profit to treasury
5. Morpho pulls repayment
6. Transaction completes atomically

**Configuration**:
| Variable | Default | Description |
|----------|---------|-------------|
| `EXECUTION_MODE` | `flashloan` | Must be `flashloan` |
| `USE_EXECUTOR_V2` | `0` | Keep as `0` for V1 |
| `FLASHLOAN_EXECUTOR_ADDRESS_999` | - | Deployed V1 executor |
| `FLASHLOAN_BUFFER_BPS` | `10000` | Buffer on flashloan (100%) |
| `MIN_FLASHLOAN_PROFIT` | `0` | Minimum profit in loan token units |

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
│       ├── routeLiquidSwap.js # LiquidSwap routing (collateral → loan)
│       ├── prjxQuoter.js     # Project X quoter (loan → WHYPE for V2)
│       ├── encodePlan.js     # Call encoding (prefund + flashloan V1/V2)
│       ├── simulate.js       # Simulation logic
│       ├── execute.js        # Execution dispatcher (prefund + flashloan V1/V2)
│       ├── operations.js     # Cooldowns, caps, notifications
│       ├── telegram.js       # Telegram client with rate limiting
│       ├── telegramFormat.js # Telegram message formatting
│       ├── logger.js         # JSONL structured logging
│       ├── report.js         # CLI output formatter
│       └── retry.js          # HTTP retry utility
├── package.json
├── .env.example
└── README.md

packages/executors/
├── contracts/
│   ├── interfaces/
│   │   ├── IMorpho.sol              # Morpho interface
│   │   ├── IPrjxSwapRouter.sol      # Project X router interface
│   │   └── IPrjxQuoter.sol          # Project X quoter interface
│   ├── morpho/
│   │   ├── Executor606BaXt.sol                  # Prefund executor
│   │   ├── MorphoFlashloanExecutor606BaXt.sol   # Flashloan V1 executor
│   │   └── MorphoFlashloanExecutorV2.sol        # Flashloan V2 executor (HYPE profits)
│   └── test/
│       └── ProfitSwapTester.sol     # Isolated profit swap tester
├── scripts/
│   ├── deploy_morpho_executor.js               # Deploy prefund executor
│   ├── deploy_morpho_flashloan_executor.js     # Deploy flashloan V1 executor
│   ├── deploy_morpho_flashloan_executor_v2.js  # Deploy flashloan V2 executor
│   ├── deploy_profit_swap_tester.js            # Deploy profit swap tester
│   └── test_profit_swap.js                     # Test profit swap flow
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

### Flashloan V2 Call Sequence (HYPE profits)

```
FlashloanExecutorV2.flashV2(token, assets, calls, treasury, profitSwapParams, skip)
  └─> morpho.flashLoan(token, assets, callbackData)
        └─> FlashloanExecutorV2.onMorphoFlashLoan(assets, data)
              ├── _executeCalls(calls)
              │     ├── ERC20.approve(Morpho, repayAmount)
              │     ├── Morpho.liquidate(params, borrower, seize, repay, "0x")
              │     ├── ERC20.approve(LiquidSwap, seizeAmount)
              │     └── LiquidSwap.executeSwaps(...)  # collateral → loanToken
              ├── ERC20.approve(Morpho, assets)  # For flashloan repayment
              ├── _swapProfitToHype(loanToken, profit, params)
              │     ├── ERC20.approve(ProjectX, profit)
              │     ├── ProjectX.exactInputSingle(...)  # loanToken → WHYPE
              │     └── WHYPE.withdraw(balance)  # WHYPE → HYPE
              └── treasury.call{value: hypeBalance}("")  # Send native HYPE
        └─> Morpho pulls repayment
```

### Flashloan V1 Call Sequence (loan token profits)

```
FlashloanExecutor.flash_606BaXt(token, assets, calls, treasury, minProfit)
  └─> morpho.flashLoan(token, assets, callbackData)
        └─> FlashloanExecutor.onMorphoFlashLoan(assets, data)
              ├── ERC20.approve(Morpho, repayAmount)
              ├── Morpho.liquidate(params, borrower, seize, repay, "0x")
              ├── ERC20.approve(LiquidSwap, seizeAmount)
              ├── LiquidSwap.executeSwaps(...)
              ├── ERC20.approve(Morpho, assets)  # For flashloan repayment
              └── ERC20.transfer(treasury, profit)  # loan token profit
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
| Project X Router | `0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B` |
| Project X Quoter | `0x51f82BCf0785EB8E2297e02F36AB38aca23eb0c6` |

### Deployed Executors

| Executor | Address |
|----------|---------|
| Flashloan V2 (HYPE profits) | `0x51C6d213a8A9103ad795596EB28070F7ff525B4e` |
| Flashloan V1 (loan token profits) | `0x98FCe9e656DBc832B2e2392a3fE188f7518CC234` |

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

### "FLASHLOAN_EXECUTOR_V2_ADDRESS_999 is required"
Set the V2 flashloan executor address in your `.env` when `USE_EXECUTOR_V2=1`.

### "EXECUTOR_ADDRESS_999 is required"
Set the executor address in your `.env` when `EXECUTION_MODE=prefund`.

### "Flashloan executor verification failed"
Check that:
- Bot EOA is owner of the flashloan executor
- Flashloan executor has correct Morpho Blue address configured
- For V2: WHYPE address is correct

### "Bot account is not owner of executor"
The private key must correspond to the address that deployed/owns the executor.

### "InsufficientProfit" revert (V1)
The flashloan execution didn't generate enough profit in loan token. Check:
- Swap route is available and returns expected output
- `MIN_FLASHLOAN_PROFIT` isn't set too high
- Slippage settings allow profitable execution

### "InsufficientBalance" revert (V2)
The loan token balance after liquidation is less than the flashloan amount to repay. This means:
- The liquidation is genuinely unprofitable
- Collateral value < debt value (bad debt scenario)
- Try increasing `FLASHLOAN_BUFFER_BPS` (but note this is likely a market condition issue)

### "InsufficientHypeProfit" revert (V2)
The HYPE profit after swap is less than `minHypeOut`. Check:
- `PROFIT_SLIPPAGE_BPS` isn't too aggressive
- Project X pool has sufficient liquidity

### "No HYPE route found" warning (V2)
The Project X quoter couldn't find a route for loanToken → WHYPE. Possible causes:
- No Project X pool exists for this token pair
- Pool has insufficient liquidity
- Bot will still attempt V2 with default params (may fail)

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

## JSONL Logging

The bot supports structured JSONL (JSON Lines) logging for operational monitoring and analysis. Enable it by setting:

```env
LOG_FORMAT=jsonl
```

### Event Types

The bot emits the following event types:

- **`tick_start`**: Emitted at the beginning of each tick
- **`tick_end`**: Emitted at the end of each tick with comprehensive summary
- **`tick_skip`**: Emitted when a tick is skipped (no candidates, all filtered, etc.)
- **`tx_sent`**: Emitted when a transaction is broadcast
- **`tx_confirmed`**: Emitted when a transaction is confirmed
- **`error`**: Emitted on errors with stage context

### Event Schema

All events include:
- `ts`: ISO timestamp
- `bot`: "EREBUS"
- `chainId`: Chain ID (999 for HyperEVM)
- `type`: Event type
- `tickId`: Tick identifier (e.g., "T62")
- `mode`: Execution mode ("BASE", "FLASHLOAN", "FLASHLOAN_V2", or "PREFUND")

#### tick_start

Additional fields:
- `config`: Configuration snapshot (intervalSec, batchSize, mode, executionEnabled, useExecutorV2)
- `cache`: Cache TTLs (vaultsTtlSec, marketsTtlSec) if applicable
- `versions`: Version info (commit, pkgVersion) if available

#### tick_end

Additional fields:
- `durationMs`: Tick duration in milliseconds
- `summary`: Comprehensive summary object with:
  - `candidates`: Requested, received, unique counts and sources
  - `confirmation`: Checked, liquidatable, healthy counts, duration, throughput, per-market stats
  - `filtering`: Input, passed, cooldown, cap, dust counts
  - `planning`: Plans built, simulated, profitable, and dropped reasons
  - `execution`: Sent, confirmed, success, fail counts and mode
- `economics`: Total profit (asset/USD) and gas usage (if available)
- `rates`: API/RPC call counts
- `liquidatableUsers`: Array of up to 5 liquidatable positions (user, marketId, pair, repayAssets, repaySymbol)
- `droppedExamples`: Array of up to 3 dropped examples with reasons
- `phases`: Phase timings in milliseconds (candidatesMs, confirmationMs, filteringMs, planningMs, simulationMs, executionMs)
- `successRates`: Calculated success rates as percentages (filterPassRate, simSuccessRate, execSuccessRate)
- `status`: Overall tick status ("success", "partial", "completed", "all_filtered", "no_liquidatable")
- `backlog`: Backlog state at tick end (size, lastFetchTime, ageSeconds)

#### tick_skip

Additional fields:
- `durationMs`: Tick duration
- `reasonCode`: Stable short code (e.g., "NO_VAULTS", "ALL_FILTERED", "NO_CANDIDATES")
- `reason`: Human-readable reason
- `counts`: Snapshot of candidates, confirmedLiquidatable, passed

#### tx_sent / tx_confirmed

Additional fields:
- `txHash`: Transaction hash
- `marketId`: Market ID
- `user`: User address
- `pair`: Token pair (e.g., "WHYPE→USDC")
- `repay`: Repay details (assets, symbol, decimals)
- `profit`: Profit details (V1: assets, symbol, usd | V2: hype, minHype)
- `gas`: Gas details (limit, price, used for confirmed)
- `route`: Route details (venue, to, calldataSize)
- `explorerUrl`: Explorer URL (for chainId 999: hyperevmscan.com)

**V2-specific fields** (mode=FLASHLOAN_V2):
- `flashloan`: Flashloan details (token, assets)
- `profitSwap`: Profit swap config (router, feeTier, skip)
- `status`: Transaction status ("success" or "reverted") - tx_confirmed only
- `blockNumber`: Block number - tx_confirmed only

#### error

Additional fields:
- `stage`: Error stage ("candidates", "confirm", "filter", "plan", "simulate", "execute", "telegrams", "unknown")
- `marketId`: Market ID if available
- `user`: User address if available
- `message`: Error message (truncated to 160 chars)
- `errorCode`: Optional error code

### Backward Compatibility

All new fields are additive. Existing fields remain unchanged. Fields are only included when they have values (no null/undefined fields).

### Example Output

**V2 Mode (HYPE profits):**
```jsonl
{"ts":"2026-01-17T10:30:00.000Z","bot":"EREBUS","chainId":999,"type":"tick_start","tickId":"T42","mode":"FLASHLOAN_V2","config":{"intervalSec":30,"batchSize":400,"mode":"flashloan","executionEnabled":true,"useExecutorV2":true},"cache":{"vaultsTtlSec":1800,"marketsTtlSec":900},"versions":{"pkgVersion":"5.0.0","commit":"abc1234"}}
{"ts":"2026-01-17T10:30:05.123Z","bot":"EREBUS","chainId":999,"type":"tick_end","tickId":"T42","mode":"FLASHLOAN_V2","durationMs":5123,"summary":{"candidates":{"requested":400,"received":150,"unique":120},"confirmation":{"checked":45,"liquidatable":12,"healthy":33},"filtering":{"input":12,"passed":8},"planning":{"plansBuilt":8,"plansSimulated":8,"plansProfitable":3},"execution":{"sent":3,"confirmed":3,"success":2,"fail":1,"mode":"FLASHLOAN_V2"},"phases":{"candidatesMs":1200,"confirmationMs":234,"filteringMs":45,"planningMs":890,"simulationMs":2100,"executionMs":654},"status":"success"}}
{"ts":"2026-01-17T10:30:05.456Z","bot":"EREBUS","chainId":999,"type":"tx_sent","tickId":"T42","mode":"FLASHLOAN_V2","txHash":"0x...","marketId":"0x...","user":"0x...","pair":"WHYPE→USDC","repay":{"assets":"1000000","symbol":"USDC","decimals":6},"profit":{"hype":"39000000000000000","minHype":"38000000000000000"},"flashloan":{"token":"0xb50A...","assets":"1000000"},"gas":{"limit":"800000","price":"117000"},"route":{"venue":"LiquidSwap","to":"0x744...","calldataSize":1024},"profitSwap":{"router":"0x1EbD...","feeTier":3000,"skip":false},"explorerUrl":"https://hyperevmscan.com/tx/0x..."}
{"ts":"2026-01-17T10:30:10.789Z","bot":"EREBUS","chainId":999,"type":"tx_confirmed","tickId":"T42","mode":"FLASHLOAN_V2","txHash":"0x...","status":"success","blockNumber":24813950,"marketId":"0x...","user":"0x...","pair":"WHYPE→USDC","repay":{"assets":"1000000","symbol":"USDC","decimals":6},"profit":{"hype":"39000000000000000","minHype":"38000000000000000"},"gas":{"used":650000,"limit":"800000","price":"117000"},"route":{"venue":"LiquidSwap","to":"0x744...","calldataSize":1024},"explorerUrl":"https://hyperevmscan.com/tx/0x..."}
```

**V1 Mode (loan token profits):**
```jsonl
{"ts":"2026-01-17T10:30:00.000Z","bot":"EREBUS","chainId":999,"type":"tick_start","tickId":"T42","mode":"FLASHLOAN","config":{"intervalSec":30,"batchSize":400,"mode":"flashloan","executionEnabled":true,"useExecutorV2":false}}
{"ts":"2026-01-17T10:30:05.456Z","bot":"EREBUS","chainId":999,"type":"tx_sent","tickId":"T42","mode":"FLASHLOAN","txHash":"0x...","marketId":"0x...","user":"0x...","pair":"WHYPE→USDC","repay":{"assets":"1000000","symbol":"USDC","decimals":6},"profit":{"assets":"50000","symbol":"USDC"},"gas":{"limit":"500000","price":"1000000000"},"route":{"venue":"LiquidSwap","to":"0x...","calldataSize":1024},"explorerUrl":"https://hyperevmscan.com/tx/0x..."}
{"ts":"2026-01-17T10:30:10.789Z","bot":"EREBUS","chainId":999,"type":"tx_confirmed","tickId":"T42","mode":"FLASHLOAN","txHash":"0x...","marketId":"0x...","user":"0x...","pair":"WHYPE→USDC","repay":{"assets":"1000000","symbol":"USDC","decimals":6},"profit":{"assets":"50000","symbol":"USDC"},"gas":{"used":450000,"limit":"500000","price":"1000000000"},"route":{"venue":"LiquidSwap","to":"0x...","calldataSize":1024},"explorerUrl":"https://hyperevmscan.com/tx/0x..."}
```

## Milestones

- **Milestone 1**: Data flow plumbing (vaults → markets → positions)
- **Milestone 2**: SDK confirmation + simulation + profitability gating
- **Milestone 3**: ✅ Execution via Executor (prefunded mode)
- **Milestone 4**: ✅ Morpho flashloan mode (atomic execution, loan token profits)
- **Milestone 5**: ✅ HYPE-denominated profits (V2 executor, gas-aware profitability)
