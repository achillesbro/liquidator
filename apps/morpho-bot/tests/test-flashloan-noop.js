/**
 * Test Script: No-op Flashloan
 * 
 * Tests the flashloan executor by:
 * 1. Borrowing a small amount of tokens via flashloan
 * 2. Executing no operations (empty calls array)
 * 3. Approving Morpho to pull repayment
 * 
 * This tests the flashloan callback mechanism without needing a liquidatable position.
 * 
 * IMPORTANT: The executor must have enough tokens to cover the flashloan amount
 * since we're not doing any swaps to generate profit.
 * 
 * Usage:
 *   FLASHLOAN_TOKEN=0x... FLASHLOAN_AMOUNT=1000000 node tests/test-flashloan-noop.js
 */

import 'dotenv/config';
import { createPublicClient, createWalletClient, http, encodeFunctionData, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Flashloan executor ABI (subset)
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
];

async function main() {
  console.log('=== Flashloan No-op Test ===\n');

  // Config
  const RPC_URL = process.env.RPC_URL_999 || 'https://rpc.hyperliquid.xyz/evm';
  const PRIVATE_KEY = process.env.LIQUIDATION_PRIVATE_KEY_999;
  const EXECUTOR_ADDRESS = process.env.FLASHLOAN_EXECUTOR_ADDRESS_999 || '0x98FCe9e656DBc832B2e2392a3fE188f7518CC234';
  const TREASURY_ADDRESS = process.env.TREASURY_ADDRESS_999 || '0xdA042130f265e594e3f8aF12E006F63BAD2349d3';
  
  // Flashloan parameters
  const FLASHLOAN_TOKEN = process.env.FLASHLOAN_TOKEN || '0x5555555555555555555555555555555555555555'; // WHYPE
  const FLASHLOAN_AMOUNT = BigInt(process.env.FLASHLOAN_AMOUNT || '100000000000000000'); // 0.1 token default
  
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
  console.log('  Flashloan Amount:', FLASHLOAN_AMOUNT.toString());
  console.log('  Dry Run:', DRY_RUN);
  console.log('  Signer:', account.address);
  console.log('');

  // Verify executor
  console.log('1. Verifying executor...');
  const [owner, morpho] = await Promise.all([
    publicClient.readContract({
      address: EXECUTOR_ADDRESS,
      abi: FLASHLOAN_EXECUTOR_ABI,
      functionName: 'owner',
    }),
    publicClient.readContract({
      address: EXECUTOR_ADDRESS,
      abi: FLASHLOAN_EXECUTOR_ABI,
      functionName: 'morpho',
    }),
  ]);

  console.log('  Owner:', owner);
  console.log('  Morpho:', morpho);

  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`❌ Signer ${account.address} is not the owner ${owner}`);
    process.exit(1);
  }
  console.log('  ✓ Signer is owner');
  console.log('');

  // Check token info and balances
  console.log('2. Checking token and balances...');
  const [symbol, decimals, executorBalance] = await Promise.all([
    publicClient.readContract({
      address: FLASHLOAN_TOKEN,
      abi: ERC20_ABI,
      functionName: 'symbol',
    }),
    publicClient.readContract({
      address: FLASHLOAN_TOKEN,
      abi: ERC20_ABI,
      functionName: 'decimals',
    }),
    publicClient.readContract({
      address: FLASHLOAN_TOKEN,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [EXECUTOR_ADDRESS],
    }),
  ]);

  console.log('  Token:', symbol);
  console.log('  Decimals:', decimals);
  console.log('  Executor balance:', formatUnits(executorBalance, decimals), symbol);
  console.log('  Flashloan amount:', formatUnits(FLASHLOAN_AMOUNT, decimals), symbol);
  console.log('');

  // Note: For a no-op flashloan, executor does NOT need pre-existing balance.
  // Morpho sends tokens first, callback runs, then Morpho pulls repayment.
  // The executor just needs to approve Morpho to pull the same tokens back.
  if (executorBalance > 0n) {
    console.log(`  ✓ Executor has existing balance (not required for no-op)`);
  } else {
    console.log(`  ℹ️  Executor has no balance (OK for no-op - Morpho provides tokens)`);
  }

  // Build the flashloan call with empty calls array
  // The executor will:
  // 1. Receive flashloan tokens from Morpho
  // 2. Execute empty calls array (no-op)
  // 3. Approve Morpho to pull repayment from existing balance
  // 4. No profit (minProfit = 0)
  
  console.log('3. Building flashloan call...');
  const calls = []; // Empty - no operations
  const minProfit = 0n;

  const calldata = encodeFunctionData({
    abi: FLASHLOAN_EXECUTOR_ABI,
    functionName: 'flash_606BaXt',
    args: [FLASHLOAN_TOKEN, FLASHLOAN_AMOUNT, calls, TREASURY_ADDRESS, minProfit],
  });

  console.log('  Calls: [] (empty - no-op)');
  console.log('  Min Profit: 0');
  console.log('  Calldata length:', calldata.length, 'chars');
  console.log('  Function selector:', calldata.slice(0, 10));
  console.log('');

  // Simulate
  console.log('4. Simulating flashloan...');
  try {
    await publicClient.simulateContract({
      address: EXECUTOR_ADDRESS,
      abi: FLASHLOAN_EXECUTOR_ABI,
      functionName: 'flash_606BaXt',
      args: [FLASHLOAN_TOKEN, FLASHLOAN_AMOUNT, calls, TREASURY_ADDRESS, minProfit],
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
  console.log('5. Executing flashloan...');
  const hash = await walletClient.writeContract({
    address: EXECUTOR_ADDRESS,
    abi: FLASHLOAN_EXECUTOR_ABI,
    functionName: 'flash_606BaXt',
    args: [FLASHLOAN_TOKEN, FLASHLOAN_AMOUNT, calls, TREASURY_ADDRESS, minProfit],
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

  console.log('6. Final state:');
  console.log('  Executor balance:', formatUnits(finalBalance, decimals), symbol);
  console.log('  Change:', formatUnits(finalBalance - executorBalance, decimals), symbol);
  console.log('');

  console.log('=== Flashloan No-op Test Complete ===');
}

main().catch(console.error);
