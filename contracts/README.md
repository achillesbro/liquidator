# IsolatedLiquidator Contracts

Solidity contracts for liquidating HyperLend Isolated Pair positions.

## Contract

### IsolatedLiquidator.sol

Main liquidation contract that:
- Accepts flashloans from Core Pool (USDC)
- Liquidates isolated pair positions
- Swaps collateral (xHYPE) to USDC via ProjectX
- Repays flashloan and keeps profit

**Constructor Parameters:**
- `_pool`: Core Pool address (0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b)
- `_pair`: Isolated Pair address (0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd)
- `_usdc`: USDC token address (0xb88339CB7199b77E23DB6E890353E22632Ba630f)
- `_prjxRouter`: ProjectX SwapRouter address (0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B)

**Key Functions:**
- `run(borrower, sharesToLiquidate, minUsdcOut, deadline)`: Execute liquidation (onlyOwner)
- `rescueTokens(token, amount, max, to)`: Extract profit (onlyOwner)

**Events:**
- `LiquidationExecuted(borrower, sharesToLiquidate, repayAmount, premium, seizedXHype, usdcOut, profitUsdc)`

## Interfaces

- `IHyperlendIsolatedPair.sol`: Isolated pair interface
- `IPrjxSwapRouter.sol`: ProjectX UniV3 router interface
- `IPrjxQuoter.sol`: ProjectX quoter interface (used by bot)

## Deployment

```bash
npx hardhat run scripts/deploy.js --network hyperEvm
```

## Testing

```bash
# Simulate liquidation (requires borrower address)
npx hardhat run scripts/test-simulate.js --network hyperEvm
```
