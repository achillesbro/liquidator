# HyperLend Isolated Pair Liquidator

Liquidation bot for HyperLend Isolated Pairs using Core Pool flashloans and ProjectX swaps.

## Architecture

### Flow
1. **Core Pool Flashloan**: Borrow USDC from HyperLend Core Pool
2. **Isolated Pair Liquidation**: Liquidate xHYPE/USDC isolated pair position
3. **ProjectX Swap**: Swap seized xHYPE to USDC via ProjectX UniV3 (fee=100, 0.01%)
4. **Repay Flashloan**: Repay borrowed USDC + premium
5. **Profit**: Remaining USDC stays in contract, extracted via rescue script

### Contracts

- **IsolatedLiquidator.sol**: Main liquidation contract
  - Uses `flashLoanSimple` from Core Pool
  - Calls `pair.liquidate()` on isolated pair
  - Swaps via ProjectX Router `exactInputSingle`
  - Emits `LiquidationExecuted` event with profit details

### Bot

- **index.js**: Main bot loop (cron every minute)
  - Fetches candidates from HyperLend API (with JSON fallback)
  - Computes liquidation parameters with conservative caps
  - Simulates transactions via `eth_call` before sending
  - Sends Telegram notifications on successful liquidations
  - Rescues profit to configured address

## Configuration

### Chain
- **Network**: HyperEVM
- **ChainId**: 999
- **RPC**: https://rpc.hyperliquid.xyz/evm

### Addresses
- **Core Pool**: `0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b`
- **USDC**: `0xb88339CB7199b77E23DB6E890353E22632Ba630f`
- **Isolated Pair (xHYPE/USDC)**: `0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd`
- **ProjectX Factory**: `0xFf7B3e8C00e57ea31477c32A5B52a58Eea47b072`
- **ProjectX Quoter**: `0x239F11a7A3E08f2B8110D4CA9F6B95d4c8865258`
- **ProjectX SwapRouter**: `0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B`
- **ProjectX Pool Fee**: 100 (0.01%)

## Environment Variables

### Bot (.env in `bot/` directory)

Copy `.env.example` to `.env` and fill in the values:

```bash
# RPC Configuration
RPC_URL=https://rpc.hyperliquid.xyz/evm
# Alternative: RPC=https://rpc.hyperliquid.xyz/evm (both are supported)

# Wallet Configuration
PRIVATE_KEY=0x...  # Private key of the wallet that will send transactions

# Contract Configuration
CONTRACT_ADDRESS=0x...  # Deployed IsolatedLiquidator contract address

# Profit Configuration
PROFIT_RECEIVER=0x...  # Address to receive rescued profits

# Liquidation Parameters
MAX_REPAY_USDC=2000000  # Maximum USDC to repay per liquidation (in 6 decimals, e.g. 2000000 = 2000 USDC)
SLIPPAGE_BPS=50  # Slippage tolerance in basis points (50 = 0.5%)

# Telegram Notifications (optional)
TELEGRAM_TOKEN=  # Telegram bot token (leave empty if not using)
TELEGRAM_CHAT_ID=  # Telegram chat ID (leave empty if not using)

# Bot Control
BOT_PAUSED=false  # Set to 'true' to pause the bot (kill switch)
```

### Contracts (.env in `contracts/` directory)

For deployment scripts:

```bash
PRIVATE_KEY_MAINNET=0x...  # Private key for deployment (used by Hardhat)
```

## Deployment

```bash
cd contracts
npx hardhat run scripts/deploy.js --network hyperEvm
```

## Running the Bot

```bash
cd bot
npm install
node src/index.js
```

## Rescue Script

Extract profit from contract:

```bash
cd contracts
CONTRACT_ADDRESS=0x... PROFIT_RECEIVER=0x... npx hardhat run scripts/rescue.js --network hyperEvm
```

## Safety Features

- **Simulation**: All transactions are simulated via `eth_call` before sending
- **Slippage Protection**: Configurable slippage tolerance (default 0.5%)
- **Deadline Enforcement**: Tight deadlines (block.timestamp + 2)
- **Conservative Caps**: MAX_REPAY_USDC limits liquidation size
- **Retry Logic**: Per-borrower retry tracking with backoff
- **Kill Switch**: BOT_PAUSED env var to pause bot
- **Exact Approvals**: Approvals limited to exact amounts, not max

## Candidate Sources

1. **HyperLend API** (preferred, TODO: implement endpoint)
2. **candidates.json** (fallback: array of borrower addresses)

## Notes

- Contract uses exact approvals for safety
- Profit accumulates in contract and must be rescued manually
- Telegram notifications require bot token and chat ID
- Simulation failures skip the transaction (no gas spent)
