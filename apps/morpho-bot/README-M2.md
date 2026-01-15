# Morpho Bot - Milestone 2

Morpho Blue liquidation bot with candidate discovery, real-time confirmation, and simulation.

## Status: Milestone 2 Complete ✅

**Current capabilities:**
- ✅ Candidate discovery via Morpho Blue API (GraphQL)
- ✅ Real-time onchain confirmation using viem
- ✅ Swap routing via LiquidSwap API
- ✅ Call encoding for liquidation + swaps
- ✅ Simulation without sending transactions
- ❌ No transaction execution (Milestone 3)
- ❌ No flashloan mode (Milestone 4)

## Quick Start

### 1. Setup Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your RPC URL (default works)
# RPC_URL_999=https://rpc.hyperliquid.xyz/evm
```

### 2. Install Dependencies

From workspace root:

```bash
pnpm install
```

### 3. Run Bot

From workspace root:

```bash
pnpm morpho:bot
```

Or from this directory:

```bash
pnpm start
```

## Expected Output

```
Initializing Morpho Bot (Milestone 2)...
Chain ID: 999
RPC URL: https://rpc.hyperliquid.xyz/evm
Simulation Only: true
Max Candidates: 200
Max Simulations: 25

[1/7] Fetching whitelisted vaults from Morpho API...
✓ Found 19 whitelisted vaults

[2/7] Fetching markets from Morpho API...
✓ Found 12 unique markets

[3/7] Fetching candidate positions from Morpho API...
✓ Found 45 candidate positions

[4/7] Confirming liquidatable positions onchain...
✓ Confirmed 8 liquidatable positions

[5/7] Fetching swap routes from LiquidSwap...
✓ Found 8 swap routes

[6/7] Simulating liquidation plans...
✓ Simulated 8 plans
✓ 6 simulations successful

[7/7] Profit checking disabled (PROFIT_CHECK_ENABLED=0)

======================================================================
MORPHO BOT · HYPEREVM · MILESTONE 2 · SIMULATION ONLY
======================================================================
Vaults discovered:        19
Markets discovered:       12
Candidates discovered:    45
Confirmed liquidatable:   8
Routes found:             8
Simulations attempted:    8
Simulations successful:   6
Potentially profitable:   6
======================================================================

Liquidatable Positions (Simulated):
----------------------------------------------------------------------
[1] ✓ Market: 0x1234567...
    User: 0xabc...
    Pair: WETH → USDC
    Repay: 1000.0000 USDC
    Seize: 0.5000 WETH
    Swap out: 1050.0000 USDC
    Estimated profit: +50.0000 USDC
    Gas estimate: 450,000

...

✓ Milestone 2 complete: confirmation + simulation done in 12.34s
✓ No transactions sent (SIMULATION_ONLY mode)
```

## Configuration

### Required Environment Variables

```env
# RPC endpoint for HyperEVM (chainId 999)
RPC_URL_999=https://rpc.hyperliquid.xyz/evm

# Chain ID
CHAIN_ID=999
```

### Optional Environment Variables

```env
# API endpoints
MORPHO_API_URL=https://blue-api.morpho.org
LIQUIDSWAP_API_URL=https://api.liqd.ag

# Limits
MAX_CANDIDATES=200           # Max candidates to fetch from API
MAX_SIMULATIONS=25           # Max simulations per run
MAX_POSITIONS_PRINT=50       # Max positions in output

# Execution mode
SIMULATION_ONLY=1            # 1 = no transactions, 0 = send (Milestone 3+)

# Profit gating
PROFIT_CHECK_ENABLED=0       # 0 = disabled, 1 = enabled
MIN_PROFIT_USD=5.0          # Minimum profit threshold
```

## Architecture

### Data Flow

```
1. Morpho API → Whitelisted Vaults
2. Morpho API → Markets for Vaults
3. Morpho API → Candidate Positions (with borrows)
4. RPC (viem) → Confirm liquidatable onchain
5. LiquidSwap API → Swap routes
6. Encoder → Build call sequence
7. Simulator → Test execution
```

### Modules

```
src/lib/
├── env.js              # Configuration loader
├── morphoApi.js        # Morpho API vault fetching
├── candidateSource.js  # Market + position discovery
├── sdkConfirm.js       # Onchain confirmation using viem
├── routeLiquidSwap.js  # LiquidSwap routing
├── encodePlan.js       # Call encoding
├── simulate.js         # Simulation logic
├── retry.js            # HTTP retry utility
└── report.js           # Legacy (Milestone 1)
```

## How It Works

### 1. Candidate Discovery

Uses Morpho Blue GraphQL API to find:
- Whitelisted vaults on HyperEVM
- Markets allocated to those vaults
- Positions with active borrows (ordered by size)

### 2. Onchain Confirmation

For each candidate, fetches real-time data via RPC:
- Market parameters (loan/collateral tokens, LLTV, oracle)
- Market state (total borrows, supplies, shares)
- Position state (borrow shares, collateral)
- Oracle price

Calculates:
- Current borrow value
- Max allowed borrow (collateral × price × LLTV)
- Whether position is underwater
- Liquidation amounts (repay shares, seizable collateral)

### 3. Swap Routing

Queries LiquidSwap API for optimal route:
- Input: Seized collateral
- Output: Loan token (for repayment)
- Returns pre-encoded calldata (no ABI needed)

### 4. Encoding

Builds call sequence:
1. Approve loan token to Morpho (for repayment)
2. Execute liquidation on Morpho Blue
3. Approve collateral to swap router
4. Execute swap via LiquidSwap

### 5. Simulation

Tests execution feasibility:
- Simulates liquidation call
- Estimates gas usage
- Calculates rough profit (swap output - repay - gas)

## Differences from Milestone 1

| Aspect | Milestone 1 | Milestone 2 |
|--------|-------------|-------------|
| Candidate source | Ponder indexer | Morpho API (GraphQL) |
| Confirmation | None | Real-time RPC via viem |
| Swap routing | None | LiquidSwap API |
| Call encoding | None | Full encoding |
| Simulation | None | viem call simulation |
| Execution | None | None (both simulation only) |
| Dependencies | None | viem, Morpho SDKs |

## Troubleshooting

### "No candidates found"

Possible causes:
- No active borrows on HyperEVM Morpho Blue
- All positions are healthy
- API rate limiting

### "No routes found"

Possible causes:
- Insufficient liquidity for collateral token
- LiquidSwap doesn't support token pair
- Amount too large for available liquidity

### "Simulation failed"

Possible causes:
- Position became healthy between discovery and simulation
- Oracle price moved
- Insufficient balance assumptions (expected in Milestone 2)

### "RPC errors"

```env
# Use a faster RPC endpoint
RPC_URL_999=https://your-premium-rpc-endpoint
```

## Limitations (Milestone 2)

1. **No flashloans** - Assumes executor has tokens (simulation may fail due to balance)
2. **No executor contract** - Uses placeholder address for simulation
3. **No transaction sending** - Simulation only
4. **Simplified profit calculation** - No USD conversion, no gas price consideration
5. **No historical data** - Fresh API query each run
6. **Public RPC** - May be slow or rate-limited

## Next Steps

### Milestone 3
- Deploy executor contract
- Add private key configuration
- Enable transaction sending (SIMULATION_ONLY=0)
- Add real-time monitoring

### Milestone 4
- Add Morpho flashloan mode
- Add pre-liquidation support
- Optimize profitability calculations
- Add USD pricing

## Development

### Testing Without Liquidatable Positions

The bot will run successfully even if no liquidatable positions exist:

```
✓ Found 19 vaults
✓ Found 12 markets
✓ Found 0 candidate positions
✓ No candidates found. Exiting.
```

### Adding Debug Logging

Set environment variable:
```env
DEBUG=1
```

### Running Continuously

For production (Milestone 3+), wrap in a cron job or use a loop:

```bash
# Simple loop (for testing)
while true; do
  pnpm morpho:bot
  sleep 60
done
```

## Constants (HyperEVM)

- **Chain ID:** 999
- **Morpho Blue:** 0x68e37dE8d93d3496ae143F2E900490f6280C57cD
- **WHYPE (wNative):** 0x5555555555555555555555555555555555555555
- **Treasury:** 0xdA042130f265e594e3f8aF12E006F63BAD2349d3
- **Multicall3:** 0xcA11bde05977b3631167028862bE2a173976CA11
- **LiquidSwap Router:** 0x744489ee3d540777a66f2cf297479745e0852f7a

## Support

For issues:
1. Check `.env` configuration
2. Verify RPC connectivity
3. Check Morpho API status
4. Review error messages in output
