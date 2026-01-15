# Required ABIs for Morpho Blue Liquidation Bot

This document contains all essential ABIs and API information needed for the Morpho Blue liquidation bot.

## Table of Contents

1. [Morpho Blue Core ABI](#morpho-blue-core-abi)
2. [Morpho Flashloan Interface ABI](#morpho-flashloan-interface-abi)
3. [Executor ABI](#executor-abi)
4. [ERC20 ABI](#erc20-abi)
5. [Uniswap V3 SwapRouter ABI](#uniswap-v3-swaprouter-abi)
6. [Uniswap V3 QuoterV2 ABI](#uniswap-v3-quoterv2-abi)
7. [Uniswap V3 Pool ABI](#uniswap-v3-pool-abi)
8. [Uniswap V4 PoolManager ABI](#uniswap-v4-poolmanager-abi)
9. [Uniswap V4 Quoter ABI](#uniswap-v4-quoter-abi)
10. [LiquidSwap Router ABI](#liquidswap-router-abi)
11. [Ponder API Endpoints](#ponder-api-endpoints)
12. [Ponder Schema Table Names](#ponder-schema-table-names)

---

## Morpho Blue Core ABI

Functions used by the liquidation encoder: `liquidate`, `flashLoan`, `market`, `position`, `accrueInterest`, `idToMarketParams`.

### liquidate

```json
{
  "inputs": [
    {
      "components": [
        { "internalType": "address", "name": "loanToken", "type": "address" },
        { "internalType": "address", "name": "collateralToken", "type": "address" },
        { "internalType": "address", "name": "oracle", "type": "address" },
        { "internalType": "address", "name": "irm", "type": "address" },
        { "internalType": "uint256", "name": "lltv", "type": "uint256" }
      ],
      "internalType": "struct MarketParams",
      "name": "marketParams",
      "type": "tuple"
    },
    { "internalType": "address", "name": "borrower", "type": "address" },
    { "internalType": "uint256", "name": "seizedAssets", "type": "uint256" },
    { "internalType": "uint256", "name": "repaidShares", "type": "uint256" },
    { "internalType": "bytes", "name": "data", "type": "bytes" }
  ],
  "name": "liquidate",
  "outputs": [
    { "internalType": "uint256", "name": "", "type": "uint256" },
    { "internalType": "uint256", "name": "", "type": "uint256" }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
}
```

### flashLoan

```json
{
  "inputs": [
    { "internalType": "address", "name": "token", "type": "address" },
    { "internalType": "uint256", "name": "assets", "type": "uint256" },
    { "internalType": "bytes", "name": "data", "type": "bytes" }
  ],
  "name": "flashLoan",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}
```

### market

```json
{
  "inputs": [{ "internalType": "Id", "name": "", "type": "bytes32" }],
  "name": "market",
  "outputs": [
    { "internalType": "uint128", "name": "totalSupplyAssets", "type": "uint128" },
    { "internalType": "uint128", "name": "totalSupplyShares", "type": "uint128" },
    { "internalType": "uint128", "name": "totalBorrowAssets", "type": "uint128" },
    { "internalType": "uint128", "name": "totalBorrowShares", "type": "uint128" },
    { "internalType": "uint128", "name": "lastUpdate", "type": "uint128" },
    { "internalType": "uint128", "name": "fee", "type": "uint128" }
  ],
  "stateMutability": "view",
  "type": "function"
}
```

### position

```json
{
  "inputs": [
    { "internalType": "Id", "name": "", "type": "bytes32" },
    { "internalType": "address", "name": "", "type": "address" }
  ],
  "name": "position",
  "outputs": [
    { "internalType": "uint256", "name": "supplyShares", "type": "uint256" },
    { "internalType": "uint128", "name": "borrowShares", "type": "uint128" },
    { "internalType": "uint128", "name": "collateral", "type": "uint128" }
  ],
  "stateMutability": "view",
  "type": "function"
}
```

### accrueInterest

```json
{
  "inputs": [
    {
      "components": [
        { "internalType": "address", "name": "loanToken", "type": "address" },
        { "internalType": "address", "name": "collateralToken", "type": "address" },
        { "internalType": "address", "name": "oracle", "type": "address" },
        { "internalType": "address", "name": "irm", "type": "address" },
        { "internalType": "uint256", "name": "lltv", "type": "uint256" }
      ],
      "internalType": "struct MarketParams",
      "name": "marketParams",
      "type": "tuple"
    }
  ],
  "name": "accrueInterest",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}
```

### idToMarketParams

```json
{
  "inputs": [{ "internalType": "Id", "name": "", "type": "bytes32" }],
  "name": "idToMarketParams",
  "outputs": [
    { "internalType": "address", "name": "loanToken", "type": "address" },
    { "internalType": "address", "name": "collateralToken", "type": "address" },
    { "internalType": "address", "name": "oracle", "type": "address" },
    { "internalType": "address", "name": "irm", "type": "address" },
    { "internalType": "uint256", "name": "lltv", "type": "uint256" }
  ],
  "stateMutability": "view",
  "type": "function"
}
```

---

## Morpho Flashloan Interface ABI

Same as the `flashLoan` function from Morpho Blue Core ABI above.

---

## Executor ABI

The executor contract uses a hash-based function name `exec_606BaXt` that takes an array of `Call` structs.

```json
{
  "inputs": [
    {
      "components": [
        { "internalType": "address", "name": "target", "type": "address" },
        { "internalType": "uint256", "name": "value", "type": "uint256" },
        { "internalType": "bytes", "name": "data", "type": "bytes" }
      ],
      "internalType": "struct Call[]",
      "name": "calls",
      "type": "tuple[]"
    }
  ],
  "name": "exec_606BaXt",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}
```

---

## ERC20 ABI

Standard ERC20 functions: `balanceOf`, `approve`, `transfer`.

### balanceOf

```json
{
  "inputs": [{ "internalType": "address", "name": "account", "type": "address" }],
  "name": "balanceOf",
  "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
  "stateMutability": "view",
  "type": "function"
}
```

### approve

```json
{
  "inputs": [
    { "internalType": "address", "name": "spender", "type": "address" },
    { "internalType": "uint256", "name": "amount", "type": "uint256" }
  ],
  "name": "approve",
  "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
  "stateMutability": "nonpayable",
  "type": "function"
}
```

### transfer

```json
{
  "inputs": [
    { "internalType": "address", "name": "to", "type": "address" },
    { "internalType": "uint256", "name": "amount", "type": "uint256" }
  ],
  "name": "transfer",
  "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
  "stateMutability": "nonpayable",
  "type": "function"
}
```

---

## Uniswap V3 SwapRouter ABI

### exactInputSingle

```json
{
  "inputs": [
    {
      "components": [
        { "internalType": "address", "name": "tokenIn", "type": "address" },
        { "internalType": "address", "name": "tokenOut", "type": "address" },
        { "internalType": "uint24", "name": "fee", "type": "uint24" },
        { "internalType": "address", "name": "recipient", "type": "address" },
        { "internalType": "uint256", "name": "deadline", "type": "uint256" },
        { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
        { "internalType": "uint256", "name": "amountOutMinimum", "type": "uint256" },
        { "internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160" }
      ],
      "internalType": "struct IV3SwapRouter.ExactInputSingleParams",
      "name": "params",
      "type": "tuple"
    }
  ],
  "name": "exactInputSingle",
  "outputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }],
  "stateMutability": "payable",
  "type": "function"
}
```

### exactInput

```json
{
  "inputs": [
    {
      "components": [
        { "internalType": "bytes", "name": "path", "type": "bytes" },
        { "internalType": "address", "name": "recipient", "type": "address" },
        { "internalType": "uint256", "name": "deadline", "type": "uint256" },
        { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
        { "internalType": "uint256", "name": "amountOutMinimum", "type": "uint256" }
      ],
      "internalType": "struct IV3SwapRouter.ExactInputParams",
      "name": "params",
      "type": "tuple"
    }
  ],
  "name": "exactInput",
  "outputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }],
  "stateMutability": "payable",
  "type": "function"
}
```

### exactOutputSingle

```json
{
  "inputs": [
    {
      "components": [
        { "internalType": "address", "name": "tokenIn", "type": "address" },
        { "internalType": "address", "name": "tokenOut", "type": "address" },
        { "internalType": "uint24", "name": "fee", "type": "uint24" },
        { "internalType": "address", "name": "recipient", "type": "address" },
        { "internalType": "uint256", "name": "deadline", "type": "uint256" },
        { "internalType": "uint256", "name": "amountOut", "type": "uint256" },
        { "internalType": "uint256", "name": "amountInMaximum", "type": "uint256" },
        { "internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160" }
      ],
      "internalType": "struct IV3SwapRouter.ExactOutputSingleParams",
      "name": "params",
      "type": "tuple"
    }
  ],
  "name": "exactOutputSingle",
  "outputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }],
  "stateMutability": "payable",
  "type": "function"
}
```

### exactOutput

```json
{
  "inputs": [
    {
      "components": [
        { "internalType": "bytes", "name": "path", "type": "bytes" },
        { "internalType": "address", "name": "recipient", "type": "address" },
        { "internalType": "uint256", "name": "deadline", "type": "uint256" },
        { "internalType": "uint256", "name": "amountOut", "type": "uint256" },
        { "internalType": "uint256", "name": "amountInMaximum", "type": "uint256" }
      ],
      "internalType": "struct IV3SwapRouter.ExactOutputParams",
      "name": "params",
      "type": "tuple"
    }
  ],
  "name": "exactOutput",
  "outputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }],
  "stateMutability": "payable",
  "type": "function"
}
```

---

## Uniswap V3 QuoterV2 ABI

### quoteExactInputSingle

```json
{
  "inputs": [
    {
      "components": [
        { "internalType": "address", "name": "tokenIn", "type": "address" },
        { "internalType": "address", "name": "tokenOut", "type": "address" },
        { "internalType": "uint24", "name": "fee", "type": "uint24" },
        { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
        { "internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160" }
      ],
      "internalType": "struct IQuoterV2.QuoteExactInputSingleParams",
      "name": "params",
      "type": "tuple"
    }
  ],
  "name": "quoteExactInputSingle",
  "outputs": [
    { "internalType": "uint256", "name": "amountOut", "type": "uint256" },
    { "internalType": "uint160", "name": "sqrtPriceX96After", "type": "uint160" },
    { "internalType": "uint32", "name": "initializedTicksCrossed", "type": "uint32" },
    { "internalType": "uint256", "name": "gasEstimate", "type": "uint256" }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
}
```

### quoteExactOutputSingle

```json
{
  "inputs": [
    {
      "components": [
        { "internalType": "address", "name": "tokenIn", "type": "address" },
        { "internalType": "address", "name": "tokenOut", "type": "address" },
        { "internalType": "uint24", "name": "fee", "type": "uint24" },
        { "internalType": "uint256", "name": "amountOut", "type": "uint256" },
        { "internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160" }
      ],
      "internalType": "struct IQuoterV2.QuoteExactOutputSingleParams",
      "name": "params",
      "type": "tuple"
    }
  ],
  "name": "quoteExactOutputSingle",
  "outputs": [
    { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
    { "internalType": "uint160", "name": "sqrtPriceX96After", "type": "uint160" },
    { "internalType": "uint32", "name": "initializedTicksCrossed", "type": "uint32" },
    { "internalType": "uint256", "name": "gasEstimate", "type": "uint256" }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
}
```

---

## Uniswap V3 Pool ABI

### swap

```json
{
  "inputs": [
    { "internalType": "address", "name": "recipient", "type": "address" },
    { "internalType": "bool", "name": "zeroForOne", "type": "bool" },
    { "internalType": "int256", "name": "amountSpecified", "type": "int256" },
    { "internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160" },
    { "internalType": "bytes", "name": "data", "type": "bytes" }
  ],
  "name": "swap",
  "outputs": [
    { "internalType": "int256", "name": "amount0", "type": "int256" },
    { "internalType": "int256", "name": "amount1", "type": "int256" }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
}
```

---

## Uniswap V4 PoolManager ABI

### swap

```json
{
  "inputs": [
    {
      "components": [
        { "internalType": "Currency", "name": "currency0", "type": "address" },
        { "internalType": "Currency", "name": "currency1", "type": "address" },
        { "internalType": "uint24", "name": "fee", "type": "uint24" },
        { "internalType": "int24", "name": "tickSpacing", "type": "int24" },
        { "internalType": "contract IHooks", "name": "hooks", "type": "address" }
      ],
      "internalType": "struct PoolKey",
      "name": "key",
      "type": "tuple"
    },
    {
      "components": [
        { "internalType": "bool", "name": "zeroForOne", "type": "bool" },
        { "internalType": "int256", "name": "amountSpecified", "type": "int256" },
        { "internalType": "uint160", "name": "sqrtPriceLimitX96", "type": "uint160" }
      ],
      "internalType": "struct IPoolManager.SwapParams",
      "name": "params",
      "type": "tuple"
    },
    { "internalType": "bytes", "name": "hookData", "type": "bytes" }
  ],
  "name": "swap",
  "outputs": [{ "internalType": "BalanceDelta", "name": "swapDelta", "type": "int256" }],
  "stateMutability": "nonpayable",
  "type": "function"
}
```

### settle

```json
{
  "inputs": [{ "internalType": "Currency", "name": "currency", "type": "address" }],
  "name": "settle",
  "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
  "stateMutability": "payable",
  "type": "function"
}
```

### take

```json
{
  "inputs": [
    { "internalType": "Currency", "name": "currency", "type": "address" },
    { "internalType": "address", "name": "to", "type": "address" },
    { "internalType": "uint256", "name": "amount", "type": "uint256" }
  ],
  "name": "take",
  "outputs": [],
  "stateMutability": "nonpayable",
  "type": "function"
}
```

---

## Uniswap V4 Quoter ABI

### quoteExactInputSingle

```json
{
  "inputs": [
    {
      "components": [
        {
          "components": [
            { "internalType": "Currency", "name": "currency0", "type": "address" },
            { "internalType": "Currency", "name": "currency1", "type": "address" },
            { "internalType": "uint24", "name": "fee", "type": "uint24" },
            { "internalType": "int24", "name": "tickSpacing", "type": "int24" },
            { "internalType": "contract IHooks", "name": "hooks", "type": "address" }
          ],
          "internalType": "struct PoolKey",
          "name": "poolKey",
          "type": "tuple"
        },
        { "internalType": "bool", "name": "zeroForOne", "type": "bool" },
        { "internalType": "uint128", "name": "exactAmount", "type": "uint128" },
        { "internalType": "bytes", "name": "hookData", "type": "bytes" }
      ],
      "internalType": "struct IV4Quoter.QuoteExactSingleParams",
      "name": "params",
      "type": "tuple"
    }
  ],
  "name": "quoteExactInputSingle",
  "outputs": [
    { "internalType": "uint256", "name": "amountOut", "type": "uint256" },
    { "internalType": "uint256", "name": "gasEstimate", "type": "uint256" }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
}
```

### quoteExactOutputSingle

```json
{
  "inputs": [
    {
      "components": [
        {
          "components": [
            { "internalType": "Currency", "name": "currency0", "type": "address" },
            { "internalType": "Currency", "name": "currency1", "type": "address" },
            { "internalType": "uint24", "name": "fee", "type": "uint24" },
            { "internalType": "int24", "name": "tickSpacing", "type": "int24" },
            { "internalType": "contract IHooks", "name": "hooks", "type": "address" }
          ],
          "internalType": "struct PoolKey",
          "name": "poolKey",
          "type": "tuple"
        },
        { "internalType": "bool", "name": "zeroForOne", "type": "bool" },
        { "internalType": "uint128", "name": "exactAmount", "type": "uint128" },
        { "internalType": "bytes", "name": "hookData", "type": "bytes" }
      ],
      "internalType": "struct IV4Quoter.QuoteExactSingleParams",
      "name": "params",
      "type": "tuple"
    }
  ],
  "name": "quoteExactOutputSingle",
  "outputs": [
    { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
    { "internalType": "uint256", "name": "gasEstimate", "type": "uint256" }
  ],
  "stateMutability": "nonpayable",
  "type": "function"
}
```

---

## LiquidSwap Router ABI

**Router Address:** `0x744489ee3d540777a66f2cf297479745e0852f7a`  
**API URL:** `https://api.liqd.ag/v2/route`

### executeSwaps

Executes swaps with fees and positive slippage sharing.

```json
{
  "inputs": [
    { "internalType": "address[]", "name": "tokens", "type": "address[]" },
    { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
    { "internalType": "uint256", "name": "minAmountOut", "type": "uint256" },
    { "internalType": "uint256", "name": "expectedAmountOut", "type": "uint256" },
    {
      "components": [
        { "internalType": "address", "name": "tokenIn", "type": "address" },
        { "internalType": "address", "name": "tokenOut", "type": "address" },
        { "internalType": "uint8", "name": "routerIndex", "type": "uint8" },
        { "internalType": "uint24", "name": "fee", "type": "uint24" },
        { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
        { "internalType": "bool", "name": "stable", "type": "bool" }
      ],
      "internalType": "struct Swap[][]",
      "name": "hopSwaps",
      "type": "tuple[][]"
    },
    { "internalType": "uint256", "name": "feeBps", "type": "uint256" },
    { "internalType": "address", "name": "feeRecipient", "type": "address" }
  ],
  "name": "executeSwaps",
  "outputs": [{ "internalType": "uint256", "name": "userAmountOut", "type": "uint256" }],
  "stateMutability": "payable",
  "type": "function"
}
```

### executeMultiHopSwap

Simpler swap function without positive slippage sharing, flat protocol fee.

```json
{
  "inputs": [
    { "internalType": "address[]", "name": "tokens", "type": "address[]" },
    { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
    { "internalType": "uint256", "name": "minAmountOut", "type": "uint256" },
    {
      "components": [
        { "internalType": "address", "name": "tokenIn", "type": "address" },
        { "internalType": "address", "name": "tokenOut", "type": "address" },
        { "internalType": "uint8", "name": "routerIndex", "type": "uint8" },
        { "internalType": "uint24", "name": "fee", "type": "uint24" },
        { "internalType": "uint256", "name": "amountIn", "type": "uint256" },
        { "internalType": "bool", "name": "stable", "type": "bool" }
      ],
      "internalType": "struct Swap[][]",
      "name": "hopSwaps",
      "type": "tuple[][]"
    }
  ],
  "name": "executeMultiHopSwap",
  "outputs": [{ "internalType": "uint256", "name": "totalAmountOut", "type": "uint256" }],
  "stateMutability": "payable",
  "type": "function"
}
```

---

## Ponder API Endpoints

**Base URL:** `PONDER_SERVICE_URL` (default: `http://localhost:42069`)

### 1. POST /chain/:chainId/liquidatable-positions

Fetches all liquidatable (and pre-liquidatable) positions for a given set of markets.

- **Request body:** `{ marketIds: Hex[] }`
- **Response:** `{ results: IndexerAPIResponse[], warnings: string[] }`
- **Used by:** `fetchLiquidatablePositions()`

### 2. POST /chain/:chainId/withdraw-queue-set

Fetches the set of markets from all vaults' withdraw queues.

- **Request body:** `{ vaults: Address[] }`
- **Response:** `Hex[]` (array of market IDs from all vaults' withdraw queues)
- **Used by:** `fetchMarketsForVaults()`

### 3. POST /chain/:id/withdraw-queue/:address

Fetches the withdraw queue for a specific vault.

- **Response:** `Hex[]` (withdraw queue for the specified vault)

### 4. GraphQL endpoint: /graphql or /

Standard Ponder GraphQL API for querying indexed data.

### 5. SQL endpoint: /sql/*

Direct SQL queries via Ponder client.

---

## Ponder Schema Table Names

These are the table names used in the Ponder schema (`ponder.schema.ts`).

### market

- **Primary key:** `(chainId, id)`
- **Fields:** `chainId`, `id`, `loanToken`, `collateralToken`, `oracle`, `irm`, `lltv`, `totalSupplyAssets`, `totalSupplyShares`, `totalBorrowAssets`, `totalBorrowShares`, `lastUpdate`, `fee`, `rateAtTarget`
- **Description:** Stores Morpho Blue market data

### position

- **Primary key:** `(chainId, marketId, user)`
- **Fields:** `chainId`, `marketId`, `user`, `supplyShares`, `borrowShares`, `collateral`
- **Description:** Stores user positions in markets

### authorization

- **Primary key:** `(chainId, authorizer, authorizee)`
- **Fields:** `chainId`, `authorizer`, `authorizee`, `isAuthorized`
- **Description:** Stores Morpho Blue authorization data

### pre_liquidation_contract

- **Primary key:** `(chainId, marketId, address)`
- **Fields:** `chainId`, `marketId`, `address`, `preLltv`, `preLCF1`, `preLCF2`, `preLIF1`, `preLIF2`, `preLiquidationOracle`
- **Description:** Stores PreLiquidation contract data

### vault

- **Primary key:** `(chainId, address)`
- **Fields:** `chainId`, `address`, `withdrawQueue` (array of market IDs)
- **Description:** Stores MetaMorpho vault data with withdraw queues

---

## Notes

- All ABIs are provided in JSON format for easy parsing
- Function selectors can be computed from the function signatures
- The executor function name `exec_606BaXt` is hash-based and may vary by implementation
- LiquidSwap uses an API to fetch routes, then executes swaps via the router contract
- Ponder endpoints use POST requests with JSON bodies
- BigInt values in Ponder responses are serialized as strings with `n` suffix (e.g., `"123n"`)
