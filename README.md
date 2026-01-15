# HyperLend Isolated Pair Liquidator

Liquidation bot for HyperLend Isolated Pairs using Core Pool flashloans and ProjectX swaps.

## Architecture

### Flow
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

## Configuration

### Chain
- **Network**: HyperEVM
- **ChainId**: 999
- **RPC**: https://rpc.hyperliquid.xyz/evm

### Addresses

#### Core Pool (shared)
- **Core Pool**: `0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b`

#### XHYPE/USDC Market
- **Pair**: `0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd`
- **Collateral (xHYPE)**: `0xAc962FA04BF91B7fd0DC0c5C32414E0Ce3C51E03`
- **Asset (USDC)**: `0xb88339CB7199b77E23DB6E890353E22632Ba630f`
- **Oracle**: `0x896970EB7FB914eFcDfaDA4CFFC3E3C31497Da5a`
- **Router (ProjectX)**: `0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B`
- **Quoter (ProjectX)**: `0x239F11a7A3E08f2B8110D4CA9F6B95d4c8865258`
- **Pool**: `0x6a76bd79bd97ffe55eb87c701f9ae8a1e3d7254e`
- **Fee**: 100 (0.01%)

#### WHLP/USDT0 Market
- **Pair**: `0x06Fd9D03b3d0F18E4919919b72D30c582f0a97E5`
- **Collateral (wHLP)**: `0x1359b05241cA5076c9F59605214f4F84114c0dE8`
- **Asset (USDT0)**: `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb`
- **Oracle**: `0xE0d0528707a5dc63329EC4993f58E35D77AE4eD0`
- **Router (HyperSwap Router02)**: `0x6D99e7f6747AF2cDbB5164b6DD50e40D4fDe1e77`
- **Quoter (HyperSwap QuoterV2)**: `0x03A918028f22D9E1473B7959C927AD7425A45C7C`
- **Pool**: `0x859235541c19a3b26436fe7ecddf22142d8dccae`
- **Fee**: 100 (0.01%)

## Environment Variables

### Bot (.env in `bot/` directory)

Copy `.env.example` to `.env` and fill in the values:

```bash
# RPC Configuration
RPC_URL=https://rpc.hyperliquid.xyz/evm
# Alternative: RPC=https://rpc.hyperliquid.xyz/evm (both are supported)

# Wallet Configuration
PRIVATE_KEY=0x...  # Private key of the wallet that will send transactions

# Contract Configuration (per market)
CONTRACT_ADDRESS_XHYPE_USDC=0x...  # Deployed IsolatedLiquidator contract address for XHYPE/USDC
CONTRACT_ADDRESS_WHLP_USDT0=0x...  # Deployed IsolatedLiquidator contract address for WHLP/USDT0

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

The deploy script deploys two contract instances (one for each market) in a single run:

```bash
cd contracts
npx hardhat run scripts/deploy.js --network hyperEvm
```

The script will deploy:
1. **XHYPE/USDC liquidator** using ProjectX router (fee=100)
2. **WHLP/USDT0 liquidator** using HyperSwap Router02 (fee read from pool or default 100)

Both contract addresses will be printed to the console. See `contracts/README.md` for environment variable configuration options.

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
