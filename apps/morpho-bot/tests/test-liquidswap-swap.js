/**
 * Test Script: LiquidSwap Swap via Executor
 * 
 * Tests the prefund executor's ability to execute a LiquidSwap swap:
 * 1. Fund executor with input token
 * 2. Get swap route from LiquidSwap API
 * 3. Execute swap via executor
 * 
 * Usage:
 *   TOKEN_IN=0x... TOKEN_OUT=0x... AMOUNT_IN=1000000 node tests/test-liquidswap-swap.js
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

// Prefund executor ABI
const EXECUTOR_ABI = [
  {
    name: 'exec_606BaXt',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'calls', type: 'tuple[]', components: [
        { name: 'target', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ]},
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
    name: 'rescue',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
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
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
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
  console.log('=== LiquidSwap Swap Test via Executor ===\n');

  // Config
  const RPC_URL = process.env.RPC_URL_999 || 'https://rpc.hyperliquid.xyz/evm';
  const PRIVATE_KEY = process.env.LIQUIDATION_PRIVATE_KEY_999;
  const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS_999 || '0x8F9494F8d5385980e801CD13Cff085D36FD1E642';
  
  // Swap parameters
  const TOKEN_IN = process.env.TOKEN_IN || TOKENS.WHYPE;
  const TOKEN_OUT = process.env.TOKEN_OUT || TOKENS.USDC;
  const AMOUNT_IN_RAW = process.env.AMOUNT_IN; // If set, use as raw amount
  const AMOUNT_IN_HUMAN = process.env.AMOUNT_IN_HUMAN || '0.1'; // Default 0.1 WHYPE
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
  console.log('  Token In:', TOKEN_IN);
  console.log('  Token Out:', TOKEN_OUT);
  console.log('  Slippage:', SLIPPAGE_BPS, 'bps');
  console.log('  Dry Run:', DRY_RUN);
  console.log('  Signer:', account.address);
  console.log('');

  // Get token info
  console.log('1. Getting token info...');
  const [symbolIn, decimalsIn, symbolOut, decimalsOut] = await Promise.all([
    publicClient.readContract({ address: TOKEN_IN, abi: ERC20_ABI, functionName: 'symbol' }),
    publicClient.readContract({ address: TOKEN_IN, abi: ERC20_ABI, functionName: 'decimals' }),
    publicClient.readContract({ address: TOKEN_OUT, abi: ERC20_ABI, functionName: 'symbol' }),
    publicClient.readContract({ address: TOKEN_OUT, abi: ERC20_ABI, functionName: 'decimals' }),
  ]);

  console.log('  Token In:', symbolIn, `(${decimalsIn} decimals)`);
  console.log('  Token Out:', symbolOut, `(${decimalsOut} decimals)`);

  // Calculate amount
  const amountIn = AMOUNT_IN_RAW ? BigInt(AMOUNT_IN_RAW) : parseUnits(AMOUNT_IN_HUMAN, decimalsIn);
  console.log('  Amount In:', formatUnits(amountIn, decimalsIn), symbolIn);
  console.log('');

  // Check executor balance
  console.log('2. Checking balances...');
  const [executorBalanceIn, executorBalanceOut, owner] = await Promise.all([
    publicClient.readContract({ address: TOKEN_IN, abi: ERC20_ABI, functionName: 'balanceOf', args: [EXECUTOR_ADDRESS] }),
    publicClient.readContract({ address: TOKEN_OUT, abi: ERC20_ABI, functionName: 'balanceOf', args: [EXECUTOR_ADDRESS] }),
    publicClient.readContract({ address: EXECUTOR_ADDRESS, abi: EXECUTOR_ABI, functionName: 'owner' }),
  ]);

  console.log('  Executor balance (in):', formatUnits(executorBalanceIn, decimalsIn), symbolIn);
  console.log('  Executor balance (out):', formatUnits(executorBalanceOut, decimalsOut), symbolOut);
  console.log('  Owner:', owner);

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`❌ Signer ${account.address} is not the owner ${owner}`);
    process.exit(1);
  }
  console.log('  ✓ Signer is owner');

  if (executorBalanceIn < amountIn) {
    console.error(`❌ Insufficient balance: ${formatUnits(executorBalanceIn, decimalsIn)} < ${formatUnits(amountIn, decimalsIn)}`);
    console.log('   Fund the executor first, or reduce AMOUNT_IN');
    process.exit(1);
  }
  console.log('');

  // Get swap route
  console.log('3. Fetching swap route from LiquidSwap...');
  const route = await fetchSwapRoute(TOKEN_IN, TOKEN_OUT, amountIn, SLIPPAGE_BPS, decimalsIn, EXECUTOR_ADDRESS);

  if (!route) {
    console.error('❌ No route found');
    process.exit(1);
  }

  console.log('  Expected Out:', formatUnits(route.expectedOut, decimalsOut), symbolOut);
  console.log('  Min Out:', formatUnits(route.minAmountOut, decimalsOut), symbolOut);
  console.log('  Price Impact:', route.priceImpact, '%');
  console.log('  Swap Target:', route.execution.to);
  console.log('  Calldata length:', route.execution.calldata.length, 'chars');
  console.log('');

  // Build executor calls
  console.log('4. Building executor calls...');
  
  // Call 1: Approve LiquidSwap router to spend tokens
  const approveCalldata = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [route.execution.to, amountIn],
  });

  const calls = [
    {
      target: TOKEN_IN,
      value: 0n,
      data: approveCalldata,
    },
    {
      target: route.execution.to,
      value: BigInt(route.execution.value || '0'),
      data: route.execution.calldata,
    },
  ];

  console.log('  [0] Approve', route.execution.to, 'to spend', formatUnits(amountIn, decimalsIn), symbolIn);
  console.log('  [1] Swap via LiquidSwap');
  console.log('');

  // Simulate
  console.log('5. Simulating swap...');
  try {
    await publicClient.simulateContract({
      address: EXECUTOR_ADDRESS,
      abi: EXECUTOR_ABI,
      functionName: 'exec_606BaXt',
      args: [calls],
      account: account.address,
    });
    console.log('  ✓ Simulation succeeded');
  } catch (e) {
    console.error('  ❌ Simulation failed:', e.shortMessage || e.message);
    if (e.cause?.data) {
      console.error('  Revert data:', e.cause.data);
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
  console.log('6. Executing swap...');
  const hash = await walletClient.writeContract({
    address: EXECUTOR_ADDRESS,
    abi: EXECUTOR_ABI,
    functionName: 'exec_606BaXt',
    args: [calls],
  });

  console.log('  TX Hash:', hash);
  console.log('  Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('  Status:', receipt.status === 'success' ? '✓ SUCCESS' : '✗ FAILED');
  console.log('  Gas Used:', receipt.gasUsed.toString());
  console.log('  Block:', receipt.blockNumber.toString());
  console.log('');

  // Check final balances
  const [finalBalanceIn, finalBalanceOut] = await Promise.all([
    publicClient.readContract({ address: TOKEN_IN, abi: ERC20_ABI, functionName: 'balanceOf', args: [EXECUTOR_ADDRESS] }),
    publicClient.readContract({ address: TOKEN_OUT, abi: ERC20_ABI, functionName: 'balanceOf', args: [EXECUTOR_ADDRESS] }),
  ]);

  console.log('7. Final state:');
  console.log('  Balance (in):', formatUnits(finalBalanceIn, decimalsIn), symbolIn, `(Δ ${formatUnits(finalBalanceIn - executorBalanceIn, decimalsIn)})`);
  console.log('  Balance (out):', formatUnits(finalBalanceOut, decimalsOut), symbolOut, `(Δ ${formatUnits(finalBalanceOut - executorBalanceOut, decimalsOut)})`);
  console.log('');

  const swappedIn = executorBalanceIn - finalBalanceIn;
  const receivedOut = finalBalanceOut - executorBalanceOut;
  console.log('  Swapped:', formatUnits(swappedIn, decimalsIn), symbolIn);
  console.log('  Received:', formatUnits(receivedOut, decimalsOut), symbolOut);
  console.log('  Rate:', (Number(receivedOut) / Number(swappedIn) * Math.pow(10, decimalsIn - decimalsOut)).toFixed(6), `${symbolOut}/${symbolIn}`);
  console.log('');

  console.log('=== LiquidSwap Swap Test Complete ===');
}

main().catch(console.error);
