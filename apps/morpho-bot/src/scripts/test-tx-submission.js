/**
 * Test script to verify transaction submission works
 * 
 * Sends a minimal executor call (empty calls array) to verify:
 * 1. Private key signing works
 * 2. Transaction submission works
 * 3. Executor contract accepts calls from owner
 * 
 * Usage: node src/scripts/test-tx-submission.js
 * 
 * Cost: ~21,000 gas (minimal tx cost)
 */

const { formatEther, formatGwei } = require('viem');
const { getConfig } = require('../lib/env');
const { 
  createExecutionClients, 
  verifyExecutorOwnership,
  EXECUTOR_ABI,
} = require('../lib/execute');

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('TRANSACTION SUBMISSION TEST');
  console.log('='.repeat(70));
  
  // Load config
  const config = getConfig();
  
  // Validate config
  if (!config.executorAddress) {
    console.log('\n❌ EXECUTOR_ADDRESS_999 not set.');
    process.exit(1);
  }
  
  if (!config.privateKey) {
    console.log('\n❌ LIQUIDATION_PRIVATE_KEY_999 not set.');
    process.exit(1);
  }
  
  console.log('\n[1] Configuration');
  console.log('-'.repeat(40));
  console.log(`Chain ID: ${config.chainId}`);
  console.log(`RPC URL: ${config.rpcUrl}`);
  console.log(`Executor: ${config.executorAddress}`);
  
  // Create clients
  console.log('\n[2] Creating Clients');
  console.log('-'.repeat(40));
  
  const { publicClient, walletClient, account } = createExecutionClients(config);
  console.log(`✓ Account: ${account.address}`);
  
  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`✓ Balance: ${formatEther(balance)} HYPE`);
  
  if (balance === 0n) {
    console.log('\n❌ Account has 0 HYPE. Cannot send transaction.');
    console.log(`   Fund ${account.address} with some HYPE for gas.`);
    process.exit(1);
  }
  
  // Verify ownership
  console.log('\n[3] Verifying Executor Ownership');
  console.log('-'.repeat(40));
  
  const isOwner = await verifyExecutorOwnership(
    publicClient,
    config.executorAddress,
    account.address
  );
  
  if (!isOwner) {
    console.log(`❌ Account ${account.address} is NOT owner of executor`);
    process.exit(1);
  }
  console.log(`✓ Ownership verified`);
  
  // Check gas price
  console.log('\n[4] Checking Gas Price');
  console.log('-'.repeat(40));
  
  const gasPrice = await publicClient.getGasPrice();
  console.log(`✓ Current gas price: ${formatGwei(gasPrice)} gwei`);
  
  const estimatedCost = gasPrice * 50000n; // ~50k gas for empty call
  console.log(`✓ Estimated tx cost: ${formatEther(estimatedCost)} HYPE`);
  
  if (balance < estimatedCost * 2n) {
    console.log(`\n⚠ Low balance warning. May fail if gas spikes.`);
  }
  
  // Simulate first
  console.log('\n[5] Simulating Empty Executor Call');
  console.log('-'.repeat(40));
  
  try {
    await publicClient.simulateContract({
      address: config.executorAddress,
      abi: EXECUTOR_ABI,
      functionName: 'exec_606BaXt',
      args: [[]], // Empty calls array
      account,
    });
    console.log(`✓ Simulation passed`);
  } catch (error) {
    console.log(`❌ Simulation failed: ${error.shortMessage || error.message}`);
    console.log(`\nThis might mean:`);
    console.log(`  - Executor contract issue`);
    console.log(`  - RPC issue`);
    process.exit(1);
  }
  
  // Send transaction
  console.log('\n[6] Sending Transaction');
  console.log('-'.repeat(40));
  console.log(`Calling exec_606BaXt([]) on executor...`);
  
  try {
    const hash = await walletClient.writeContract({
      address: config.executorAddress,
      abi: EXECUTOR_ABI,
      functionName: 'exec_606BaXt',
      args: [[]], // Empty calls array - does nothing but validates the path
      gas: 100000n, // Generous limit for safety
    });
    
    console.log(`✓ Transaction sent!`);
    console.log(`  Hash: ${hash}`);
    console.log(`  Explorer: https://purrsec.com/tx/${hash}`);
    
    // Wait for receipt
    console.log(`\nWaiting for confirmation...`);
    
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 60_000,
    });
    
    if (receipt.status === 'success') {
      console.log(`\n✅ TRANSACTION CONFIRMED`);
      console.log(`  Block: ${receipt.blockNumber}`);
      console.log(`  Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`  Effective gas price: ${formatGwei(receipt.effectiveGasPrice)} gwei`);
      
      const actualCost = receipt.gasUsed * receipt.effectiveGasPrice;
      console.log(`  Actual cost: ${formatEther(actualCost)} HYPE`);
    } else {
      console.log(`\n❌ Transaction reverted`);
      console.log(`  This is unexpected for an empty call.`);
      console.log(`  Check the executor contract.`);
      process.exit(1);
    }
    
  } catch (error) {
    console.log(`\n❌ Transaction failed: ${error.message}`);
    
    if (error.message.includes('insufficient funds')) {
      console.log(`\n💡 Not enough HYPE for gas. Fund the account.`);
    } else if (error.message.includes('nonce')) {
      console.log(`\n💡 Nonce issue. Try again or check pending txs.`);
    } else if (error.message.includes('rejected')) {
      console.log(`\n💡 Transaction rejected by network.`);
    }
    
    process.exit(1);
  }
  
  // Final summary
  console.log('\n' + '='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`
✅ All systems operational:
   - Private key signing: WORKING
   - Transaction submission: WORKING  
   - Executor contract: WORKING
   - RPC connectivity: WORKING

Your bot is ready to execute real liquidations.

Next steps:
1. Fund executor (${config.executorAddress}) with loan tokens
2. Set EXECUTION_ENABLED=1
3. Run: pnpm morpho:bot
`);
  
  process.exit(0);
}

main().catch(error => {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
});
