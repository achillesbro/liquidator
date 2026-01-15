# IsolatedLiquidator Contracts

Solidity contracts for liquidating HyperLend Isolated Pair positions.

## Contract

### IsolatedLiquidator.sol

Main liquidation contract that supports multiple isolated markets via deployment-time configuration:
- Accepts flashloans from Core Pool (asset token)
- Liquidates isolated pair positions
- Swaps collateral to asset token via UniV3-compatible router (ProjectX or HyperSwap)
- Repays flashloan and keeps profit

**Constructor Parameters:**
- `_pool`: Core Pool address
- `_pair`: Isolated Pair address
- `_asset`: Asset token address (USDC, USDT0, etc.)
- `_swapRouter`: UniV3-compatible swap router address (ProjectX Router or HyperSwap Router02)
- `_fee`: Pool fee tier (e.g. 100 for 0.01%)

**Key Functions:**
- `run(borrower, sharesToLiquidate, minAssetOut, deadline)`: Execute liquidation (onlyOwner)
- `rescueTokens(token, amount, max, to)`: Extract profit (onlyOwner)

**Events:**
- `LiquidationExecuted(borrower, sharesToLiquidate, repayAmount, premium, seizedCollateral, assetOut, profitAsset)`

## Interfaces

- `IHyperlendIsolatedPair.sol`: Isolated pair interface
- `IUniV3SwapRouter.sol`: Generic UniV3-compatible router interface (works with ProjectX and HyperSwap)
- `IPrjxQuoter.sol`: ProjectX quoter interface (used by bot for quoting)

## Deployment

The deploy script deploys two contract instances in a single run:

```bash
cd contracts
npx hardhat run scripts/deploy.js --network hyperEvm
```

### Environment Variables

The deploy script supports the following environment variables (all optional with defaults):

```bash
# Core Pool (shared)
CORE_POOL_ADDRESS=0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b

# XHYPE/USDC Market
MARKET_XHYPE_USDC_PAIR=0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd
MARKET_XHYPE_USDC_ASSET=0xb88339CB7199b77E23DB6E890353E22632Ba630f  # USDC
MARKET_XHYPE_USDC_ROUTER=0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B  # ProjectX Router
MARKET_XHYPE_USDC_FEE=100  # 0.01%

# WHLP/USDT0 Market
MARKET_WHLP_USDT0_PAIR=0x06Fd9D03b3d0F18E4919919b72D30c582f0a97E5
MARKET_WHLP_USDT0_ASSET=0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb  # USDT0
MARKET_WHLP_USDT0_ROUTER=0x6D99e7f6747AF2cDbB5164b6DD50e40D4fDe1e77  # HyperSwap Router02
MARKET_WHLP_USDT0_FEE=100  # 0.01% (optional, will read from pool if MARKET_WHLP_USDT0_POOL is set)
MARKET_WHLP_USDT0_POOL=0x859235541c19a3b26436fe7ecddf22142d8dccae  # Optional, used for fee discovery
```

The script will:
1. Deploy XHYPE/USDC liquidator using ProjectX router
2. Deploy WHLP/USDT0 liquidator using HyperSwap Router02
3. If `MARKET_WHLP_USDT0_FEE` is not set but `MARKET_WHLP_USDT0_POOL` is set, it will read the fee from the pool
4. Print both deployed contract addresses and fees used

### Deployed Contracts

After deployment, you'll see output like:
```
=== Deployment Summary ===
XHYPE/USDC: 0x... (fee=100)
WHLP/USDT0: 0x... (fee=100)
```

## Testing

```bash
# Simulate liquidation (requires borrower address)
npx hardhat run scripts/test-simulate.js --network hyperEvm
```
