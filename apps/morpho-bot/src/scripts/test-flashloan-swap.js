/**
 * Test Script: Flashloan + LiquidSwap Swap
 * 
 * Tests the full flashloan flow with a swap:
 * 1. Flashloan token A from Morpho
 * 2. Swap token A -> token B via LiquidSwap
 * 3. Swap token B -> token A via LiquidSwap (round-trip)
 * 4. Repay flashloan
 * 
 * This tests the complete flashloan callback with swap execution.
 * Note: Round-trip swaps will incur slippage/fees, so this is a NET LOSS test.
 * The executor must have some balance to cover the loss.
 * 
 * Usage:
 *   FLASHLOAN_TOKEN=0x... SWAP_TOKEN=0x... FLASHLOAN_AMOUNT=1000000 node src/scripts/test-flashloan-swap.js
 */

import 'dotenv/config';
import { createPublicClient, createWalletClient, http, encodeFunctionData, formatUnits, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { fetchSwapRoute as fetchSwapRouteRaw } from '../lib/routeLiquidSwap.js';

// Wrapper with defaults for HyperEVM
async function fetchSwapRoute(tokenIn, tokenOut, amountInRaw, slippageBps, tokenInDecimals, recipient) {
  const LIQUIDSWAP_API = 'https://api.liqd.ag';
  const CHAIN_ID = 999;
  return fetchSwapRouteRaw(
    LIQUIDSWAP_API,
    CHAIN_ID,
    tokenIn,
    tokenOut,
    amountInRaw,
    recipient,
    tokenInDecimals
  );
}

// Flashloan executor ABI
const FLASHLOAN_EXECUTOR_ABI = [
  {
    name: 'flash_606BaXt',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'assets', type: 'uint256' },
      { name: 'calls', type: 'tuple[]', components: [
        { name: 'target', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ]},
      { name: 'treasury', type: 'address' },
      { name: 'minProfit', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'morpho',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
];

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
];

// Common token addresses on HyperEVM
const TOKENS = {
  USDe: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34',
  sUSDe: '0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2',
  USDC: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
  WHYPE: '0x5555555555555555555555555555555555555555',
};

async function main() {
  console.log('=== Flashloan + LiquidSwap Swap Test ===\n');

  // Config
  const RPC_URL = process.env.RPC_URL_999 || 'https://rpc.hyperliquid.xyz/evm';
  const PRIVATE_KEY = process.env.LIQUIDATION_PRIVATE_KEY_999;
  const EXECUTOR_ADDRESS = process.env.FLASHLOAN_EXECUTOR_ADDRESS_999 || '0x98FCe9e656DBc832B2e2392a3fE188f7518CC234';
  const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS_999 || '0xdA042130f265e594e3f8aF12E006F63BAD2349d3';
  const MORPHO_BLUE = '0x68e37dE8d93d3496ae143F2E900490f6280C57cD';
  
  // Flashloan parameters - borrow WHYPE, swap to USDC, swap back to WHYPE
  const FLASHLOAN_TOKEN = process.env.FLASHLOAN_TOKEN || TOKENS.WHYPE;
  const SWAP_TOKEN = process.env.SWAP_TOKEN || TOKENS.USDC;
  const FLASHLOAN_AMOUNT_HUMAN = process.env.FLASHLOAN_AMOUNT_HUMAN || '0.1'; // 0.1 WHYPE default
  const SLIPPAGE_BPS = parseInt(process.env.SLIPPAGE_BPS || '100'); // 1% default
  
  const DRY_RUN = process.env.DRY_RUN !== '0';

  if (!PRIVATE_KEY) {
    console.error('❌ LIQUIDATION_PRIVATE_KEY_999 not set');
    process.exit(1);
  }

  // Setup clients
  const publicClient = createPublicClient({
    transport: http(RPC_URL),
  });

  const account = privateKeyToAccount(PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`);
  const walletClient = createWalletClient({
    account,
    transport: http(RPC_URL),
  });

  console.log('Configuration:');
  console.log('  RPC:', RPC_URL);
  console.log('  Executor:', EXECUTOR_ADDRESS);
  console.log('  Treasury:', TREASURY_ADDRESS);
  console.log('  Flashloan Token:', FLASHLOAN_TOKEN);
  console.log('  Swap Token:', SWAP_TOKEN);
  console.log('  Slippage:', SLIPPAGE_BPS, 'bps');
  console.log('  Dry Run:', DRY_RUN);
  console.log('  Signer:', account.address);
  console.log('');

  // Get token info
  console.log('1. Getting token info...');
  const [flashSymbol, flashDecimals, swapSymbol, swapDecimals] = await Promise.all([
    publicClient.readContract({ address: FLASHLOAN_TOKEN, abi: ERC20_ABI, functionName: 'symbol' }),
    publicClient.readContract({ address: FLASHLOAN_TOKEN, abi: ERC20_ABI, functionName: 'decimals' }),
    publicClient.readContract({ address: SWAP_TOKEN, abi: ERC20_ABI, functionName: 'symbol' }),
    publicClient.readContract({ address: SWAP_TOKEN, abi: ERC20_ABI, functionName: 'decimals' }),
  ]);

  const flashloanAmount = parseUnits(FLASHLOAN_AMOUNT_HUMAN, flashDecimals);

  console.log('  Flashloan Token:', flashSymbol, `(${flashDecimals} decimals)`);
  console.log('  Swap Token:', swapSymbol, `(${swapDecimals} decimals)`);
  console.log('  Flashloan Amount:', formatUnits(flashloanAmount, flashDecimals), flashSymbol);
  console.log('');

  // Verify executor
  console.log('2. Verifying executor...');
  const [owner, morpho, executorBalance] = await Promise.all([
    publicClient.readContract({ address: EXECUTOR_ADDRESS, abi: FLASHLOAN_EXECUTOR_ABI, functionName: 'owner' }),
    publicClient.readContract({ address: EXECUTOR_ADDRESS, abi: FLASHLOAN_EXECUTOR_ABI, functionName: 'morpho' }),
    publicClient.readContract({ address: FLASHLOAN_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [EXECUTOR_ADDRESS] }),
  ]);

  console.log('  Owner:', owner);
  console.log('  Morpho:', morpho);
  console.log('  Executor balance:', formatUnits(executorBalance, flashDecimals), flashSymbol);

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`❌ Signer ${account.address} is not the owner ${owner}`);
    process.exit(1);
  }
  console.log('  ✓ Signer is owner');
  console.log('');

  // Get swap routes
  console.log('3. Fetching swap routes...');
  
  // Route 1: Flashloan token -> Swap token
  console.log(`  [Route 1] ${flashSymbol} -> ${swapSymbol}...`);
  const route1 = await fetchSwapRoute(FLASHLOAN_TOKEN, SWAP_TOKEN, flashloanAmount, SLIPPAGE_BPS, flashDecimals, EXECUTOR_ADDRESS);
  if (!route1) {
    console.error('  ❌ No route found for swap 1');
    process.exit(1);
  }
  console.log('    Expected:', formatUnits(route1.expectedOut, swapDecimals), swapSymbol);
  console.log('    Min:', formatUnits(route1.minAmountOut, swapDecimals), swapSymbol);
  console.log('    Price Impact:', route1.priceImpact, '%');

  // Route 2: Swap token -> Flashloan token (use expected output from route 1)
  console.log(`  [Route 2] ${swapSymbol} -> ${flashSymbol}...`);
  const route2 = await fetchSwapRoute(SWAP_TOKEN, FLASHLOAN_TOKEN, route1.minAmountOut, SLIPPAGE_BPS, swapDecimals, EXECUTOR_ADDRESS);
  if (!route2) {
    console.error('  ❌ No route found for swap 2');
    process.exit(1);
  }
  console.log('    Expected:', formatUnits(route2.expectedOut, flashDecimals), flashSymbol);
  console.log('    Min:', formatUnits(route2.minAmountOut, flashDecimals), flashSymbol);
  console.log('    Price Impact:', route2.priceImpact, '%');
  console.log('');

  // Calculate expected loss
  const expectedReturn = route2.minAmountOut;
  const expectedLoss = flashloanAmount > expectedReturn ? flashloanAmount - expectedReturn : 0n;
  const totalNeeded = flashloanAmount; // Need to repay the full flashloan amount
  
  console.log('4. Calculating costs...');
  console.log('  Flashloan amount:', formatUnits(flashloanAmount, flashDecimals), flashSymbol);
  console.log('  Expected return:', formatUnits(expectedReturn, flashDecimals), flashSymbol);
  console.log('  Expected loss:', formatUnits(expectedLoss, flashDecimals), flashSymbol);
  console.log('  Executor balance:', formatUnits(executorBalance, flashDecimals), flashSymbol);

  if (expectedReturn < flashloanAmount && executorBalance < expectedLoss) {
    console.error(`❌ Executor needs ${formatUnits(expectedLoss, flashDecimals)} ${flashSymbol} to cover swap loss`);
    console.error(`   Current balance: ${formatUnits(executorBalance, flashDecimals)} ${flashSymbol}`);
    process.exit(1);
  }
  console.log('  ✓ Executor can cover potential loss');
  console.log('');

  // Build calls for flashloan callback
  console.log('5. Building flashloan calls...');
  
  // Inside the callback, we receive the flashloan tokens
  // Then we need to:
  // 1. Approve router 1 to spend flashloan tokens
  // 2. Execute swap 1 (flashloan token -> swap token)
  // 3. Approve router 2 to spend swap tokens
  // 4. Execute swap 2 (swap token -> flashloan token)
  // Note: Approval to Morpho for repayment is handled by the contract
  
  const approve1Calldata = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [route1.execution.to, flashloanAmount],
  });

  const approve2Calldata = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [route2.execution.to, route1.minAmountOut],
  });

  const calls = [
    {
      target: FLASHLOAN_TOKEN,
      value: 0n,
      data: approve1Calldata,
    },
    {
      target: route1.execution.to,
      value: BigInt(route1.execution.value || '0'),
      data: route1.execution.calldata,
    },
    {
      target: SWAP_TOKEN,
      value: 0n,
      data: approve2Calldata,
    },
    {
      target: route2.execution.to,
      value: BigInt(route2.execution.value || '0'),
      data: route2.execution.calldata,
    },
  ];

  console.log('  [0] Approve', route1.execution.to, 'to spend', formatUnits(flashloanAmount, flashDecimals), flashSymbol);
  console.log('  [1] Swap', flashSymbol, '->', swapSymbol);
  console.log('  [2] Approve', route2.execution.to, 'to spend', formatUnits(route1.minAmountOut, swapDecimals), swapSymbol);
  console.log('  [3] Swap', swapSymbol, '->', flashSymbol);
  console.log('');

  // Simulate
  console.log('6. Simulating flashloan...');
  const minProfit = 0n; // We expect a loss, so no min profit
  
  try {
    await publicClient.simulateContract({
      address: EXECUTOR_ADDRESS,
      abi: FLASHLOAN_EXECUTOR_ABI,
      functionName: 'flash_606BaXt',
      args: [FLASHLOAN_TOKEN, flashloanAmount, calls, TREASURY_ADDRESS, minProfit],
      account: account.address,
    });
    console.log('  ✓ Simulation succeeded');
  } catch (e) {
    console.error('  ❌ Simulation failed:', e.shortMessage || e.message);
    if (e.cause?.data) {
      console.error('  Revert data:', e.cause.data);
    }
    // Try to decode common errors
    const msg = e.message || '';
    if (msg.includes('InsufficientProfit')) {
      console.error('  Reason: Not enough tokens after swaps to repay flashloan');
    }
    process.exit(1);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('=== DRY RUN - Not executing ===');
    console.log('Set DRY_RUN=0 to execute for real');
    return;
  }

  // Execute
  console.log('7. Executing flashloan...');
  const hash = await walletClient.writeContract({
    address: EXECUTOR_ADDRESS,
    abi: FLASHLOAN_EXECUTOR_ABI,
    functionName: 'flash_606BaXt',
    args: [FLASHLOAN_TOKEN, flashloanAmount, calls, TREASURY_ADDRESS, minProfit],
  });

  console.log('  TX Hash:', hash);
  console.log('  Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('  Status:', receipt.status === 'success' ? '✓ SUCCESS' : '✗ FAILED');
  console.log('  Gas Used:', receipt.gasUsed.toString());
  console.log('  Block:', receipt.blockNumber.toString());
  console.log('');

  // Check final balance
  const finalBalance = await publicClient.readContract({
    address: FLASHLOAN_TOKEN,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [EXECUTOR_ADDRESS],
  });

  console.log('8. Final state:');
  console.log('  Executor balance:', formatUnits(finalBalance, flashDecimals), flashSymbol);
  console.log('  Change:', formatUnits(finalBalance - executorBalance, flashDecimals), flashSymbol);
  console.log('');

  console.log('=== Flashloan + Swap Test Complete ===');
}

main().catch(console.error);
