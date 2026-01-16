/**
 * Execution module for Morpho liquidations
 * Milestone 4: Flashloan execution mode support
 */

const { 
  createPublicClient, 
  createWalletClient, 
  http, 
  parseAbi, 
  encodeFunctionData,
  formatEther,
  formatUnits,
} = require('viem');

// viem/accounts exports
let privateKeyToAccount;
try {
  privateKeyToAccount = require('viem/accounts').privateKeyToAccount;
} catch {
  // Fallback for older viem versions
  const viem = require('viem');
  privateKeyToAccount = viem.privateKeyToAccount;
}
const { checkExecutorBalance, ERC20_ABI } = require('./encodePlan');
const { getActiveExecutorAddress } = require('./env');

// Executor606BaXt ABI (prefund mode)
const EXECUTOR_ABI = parseAbi([
  'struct Call { address target; uint256 value; bytes data; }',
  'function exec_606BaXt((address target, uint256 value, bytes data)[] calls) external',
  'function owner() view returns (address)',
]);

// MorphoFlashloanExecutor606BaXt ABI (flashloan mode)
const FLASHLOAN_EXECUTOR_ABI = parseAbi([
  'struct Call { address target; uint256 value; bytes data; }',
  'function flash_606BaXt(address token, uint256 assets, (address target, uint256 value, bytes data)[] calls, address treasury, uint256 minProfit) external',
  'function exec_606BaXt((address target, uint256 value, bytes data)[] calls) external',
  'function owner() view returns (address)',
  'function morpho() view returns (address)',
]);

/**
 * Create clients for execution
 * @param {Object} config - Configuration
 * @returns {Object} { publicClient, walletClient, account }
 */
function createExecutionClients(config) {
  const publicClient = createPublicClient({
    transport: http(config.rpcUrl),
  });
  
  const account = privateKeyToAccount(config.privateKey.startsWith('0x') 
    ? config.privateKey 
    : `0x${config.privateKey}`
  );
  
  const walletClient = createWalletClient({
    account,
    transport: http(config.rpcUrl),
  });
  
  return { publicClient, walletClient, account };
}

/**
 * Verify executor ownership
 * @param {Object} publicClient - Viem public client
 * @param {string} executorAddress - Executor contract address
 * @param {string} expectedOwner - Expected owner address
 * @returns {Promise<boolean>} True if ownership verified
 */
async function verifyExecutorOwnership(publicClient, executorAddress, expectedOwner) {
  try {
    const owner = await publicClient.readContract({
      address: executorAddress,
      abi: EXECUTOR_ABI,
      functionName: 'owner',
    });
    return owner.toLowerCase() === expectedOwner.toLowerCase();
  } catch (error) {
    console.error(`Failed to verify executor ownership: ${error.message}`);
    return false;
  }
}

/**
 * Simulate executor call
 * @param {Object} publicClient - Viem public client
 * @param {Object} plan - Execution plan from buildCallsForExecutor
 * @param {Object} config - Configuration
 * @returns {Promise<Object>} Simulation result
 */
async function simulateExecutorCall(publicClient, plan, config) {
  const { executorAddress } = config;
  
  // Format calls for executor (remove description/metadata)
  const formattedCalls = plan.calls.map(c => ({
    target: c.target,
    value: c.value || 0n,
    data: c.data,
  }));
  
  // Create account object for simulation
  const account = privateKeyToAccount(
    config.privateKey.startsWith('0x') ? config.privateKey : `0x${config.privateKey}`
  );
  
  try {
    // Check executor loan token balance first
    const balanceCheck = await checkExecutorBalance(
      publicClient,
      executorAddress,
      plan.loanToken,
      plan.repayRequired
    );
    
    if (!balanceCheck.sufficient) {
      return {
        success: false,
        error: `Insufficient loan token balance. Have: ${balanceCheck.balance}, Need: ${balanceCheck.required}, Shortfall: ${balanceCheck.shortfall}`,
        balanceCheck,
        gasEstimate: 0,
      };
    }
    
    // Encode the executor call
    const calldata = encodeFunctionData({
      abi: EXECUTOR_ABI,
      functionName: 'exec_606BaXt',
      args: [formattedCalls],
    });
    
    // Simulate the call
    const result = await publicClient.simulateContract({
      address: executorAddress,
      abi: EXECUTOR_ABI,
      functionName: 'exec_606BaXt',
      args: [formattedCalls],
      account,
    });
    
    // Estimate gas
    let gasEstimate = plan.estimatedGas;
    try {
      const gas = await publicClient.estimateGas({
        to: executorAddress,
        data: calldata,
        account,
      });
      gasEstimate = Number(gas);
    } catch (e) {
      // Use estimated gas from plan
    }
    
    return {
      success: true,
      result,
      gasEstimate,
      balanceCheck,
      calldata,
      formattedCalls,
    };
    
  } catch (error) {
    // Parse revert reason if available
    let revertReason = error.message;
    if (error.cause?.data) {
      revertReason = error.cause.data;
    }
    if (error.shortMessage) {
      revertReason = error.shortMessage;
    }
    
    return {
      success: false,
      error: revertReason,
      gasEstimate: 0,
    };
  }
}

/**
 * Execute liquidation via executor contract
 * @param {Object} walletClient - Viem wallet client
 * @param {Object} publicClient - Viem public client
 * @param {Object} plan - Execution plan from buildCallsForExecutor
 * @param {Object} config - Configuration
 * @param {Object} simulationResult - Result from simulateExecutorCall
 * @returns {Promise<Object>} Execution result
 */
async function executeViaExecutor(walletClient, publicClient, plan, config, simulationResult) {
  const { executorAddress } = config;
  const { formattedCalls, gasEstimate } = simulationResult;
  
  try {
    // Check gas price if limit set
    if (config.maxFeeGwei) {
      const gasPrice = await publicClient.getGasPrice();
      const gasPriceGwei = Number(formatUnits(gasPrice, 9));
      if (gasPriceGwei > config.maxFeeGwei) {
        return {
          success: false,
          error: `Gas price ${gasPriceGwei.toFixed(2)} gwei exceeds limit ${config.maxFeeGwei} gwei`,
          skipped: true,
        };
      }
    }
    
    // Send transaction
    const hash = await walletClient.writeContract({
      address: executorAddress,
      abi: EXECUTOR_ABI,
      functionName: 'exec_606BaXt',
      args: [formattedCalls],
      gas: config.maxGas ? BigInt(config.maxGas) : BigInt(Math.ceil(gasEstimate * 1.3)),
    });
    
    console.log(`[EXEC_SENT] tx: ${hash}`);
    
    // Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 60_000, // 60 second timeout
    });
    
    if (receipt.status === 'success') {
      return {
        success: true,
        hash,
        receipt,
        gasUsed: Number(receipt.gasUsed),
        blockNumber: Number(receipt.blockNumber),
      };
    } else {
      return {
        success: false,
        hash,
        receipt,
        error: 'Transaction reverted',
      };
    }
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hash: error.hash,
    };
  }
}

/**
 * Calculate actual profit from execution
 * @param {Object} publicClient - Viem public client
 * @param {string} executorAddress - Executor address
 * @param {string} loanToken - Loan token address
 * @param {bigint} balanceBefore - Balance before execution
 * @returns {Promise<Object>} Profit calculation
 */
async function calculateActualProfit(publicClient, executorAddress, loanToken, balanceBefore) {
  try {
    const balanceAfter = await publicClient.readContract({
      address: loanToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [executorAddress],
    });
    
    const profit = balanceAfter - balanceBefore;
    
    return {
      balanceBefore,
      balanceAfter,
      profit,
      profitable: profit > 0n,
    };
  } catch (error) {
    return {
      error: error.message,
      profitable: false,
    };
  }
}

/**
 * Format execution result for logging
 * @param {Object} result - Execution result
 * @param {Object} plan - Execution plan
 * @returns {string} Formatted message
 */
function formatExecutionResult(result, plan) {
  const { liquidation } = plan;
  const lines = [];
  
  lines.push(`Market: ${liquidation.marketId.slice(0, 16)}...`);
  lines.push(`User: ${liquidation.user}`);
  lines.push(`Pair: ${liquidation.collateralSymbol}/${liquidation.loanSymbol}`);
  lines.push(`Repay: ${formatUnits(liquidation.repayAssets, liquidation.loanDecimals)} ${liquidation.loanSymbol}`);
  lines.push(`Seize: ${formatUnits(liquidation.seizeAssets, liquidation.collateralDecimals)} ${liquidation.collateralSymbol}`);
  
  if (result.success) {
    lines.push(`Status: SUCCESS`);
    lines.push(`TX: ${result.hash}`);
    lines.push(`Gas used: ${result.gasUsed?.toLocaleString() || 'N/A'}`);
    lines.push(`Block: ${result.blockNumber}`);
  } else {
    lines.push(`Status: FAILED`);
    lines.push(`Error: ${result.error}`);
    if (result.hash) {
      lines.push(`TX: ${result.hash}`);
    }
  }
  
  return lines.join('\n');
}

// ========================================
// Milestone 4: Flashloan Mode
// ========================================

/**
 * Verify flashloan executor configuration
 * @param {Object} publicClient - Viem public client
 * @param {string} executorAddress - Flashloan executor address
 * @param {string} expectedOwner - Expected owner address
 * @param {string} expectedMorpho - Expected Morpho Blue address
 * @returns {Promise<Object>} Verification result
 */
async function verifyFlashloanExecutor(publicClient, executorAddress, expectedOwner, expectedMorpho) {
  try {
    const [owner, morpho] = await Promise.all([
      publicClient.readContract({
        address: executorAddress,
        abi: FLASHLOAN_EXECUTOR_ABI,
        functionName: 'owner',
      }),
      publicClient.readContract({
        address: executorAddress,
        abi: FLASHLOAN_EXECUTOR_ABI,
        functionName: 'morpho',
      }),
    ]);
    
    const ownerMatch = owner.toLowerCase() === expectedOwner.toLowerCase();
    const morphoMatch = morpho.toLowerCase() === expectedMorpho.toLowerCase();
    
    return {
      valid: ownerMatch && morphoMatch,
      owner,
      morpho,
      ownerMatch,
      morphoMatch,
      errors: [
        !ownerMatch ? `Owner mismatch: expected ${expectedOwner}, got ${owner}` : null,
        !morphoMatch ? `Morpho mismatch: expected ${expectedMorpho}, got ${morpho}` : null,
      ].filter(Boolean),
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
      errors: [`Failed to verify executor: ${error.message}`],
    };
  }
}

/**
 * Simulate flashloan execution
 * @param {Object} publicClient - Viem public client
 * @param {Object} plan - Flashloan execution plan from buildCallsForFlashloan
 * @param {Object} config - Configuration
 * @returns {Promise<Object>} Simulation result
 */
async function simulateFlashloanCall(publicClient, plan, config) {
  const executorAddress = config.flashloanExecutorAddress;
  
  // Format calls for executor (remove description/metadata)
  const formattedCalls = plan.calls.map(c => ({
    target: c.target,
    value: c.value || 0n,
    data: c.data,
  }));
  
  // Create account object for simulation
  const account = privateKeyToAccount(
    config.privateKey.startsWith('0x') ? config.privateKey : `0x${config.privateKey}`
  );
  
  try {
    // Encode the flashloan executor call
    const calldata = encodeFunctionData({
      abi: FLASHLOAN_EXECUTOR_ABI,
      functionName: 'flash_606BaXt',
      args: [
        plan.flashloanToken,
        plan.flashloanAssets,
        formattedCalls,
        config.treasuryAddress,
        plan.minProfit || 0n,
      ],
    });
    
    // First, try raw eth_call to get full revert data if it fails
    let rawCallResult;
    try {
      rawCallResult = await publicClient.call({
        to: executorAddress,
        data: calldata,
        account: account.address,
      });
    } catch (callError) {
      // eth_call failed - extract the full revert data
      const revertData = callError.cause?.data || callError.data;
      if (revertData) {
        throw { rawRevertData: revertData, originalError: callError };
      }
      throw callError;
    }
    
    // If eth_call succeeded, do full simulation for gas estimate
    const result = await publicClient.simulateContract({
      address: executorAddress,
      abi: FLASHLOAN_EXECUTOR_ABI,
      functionName: 'flash_606BaXt',
      args: [
        plan.flashloanToken,
        plan.flashloanAssets,
        formattedCalls,
        config.treasuryAddress,
        plan.minProfit || 0n,
      ],
      account,
    });
    
    // Estimate gas
    let gasEstimate = plan.estimatedGas;
    try {
      const gas = await publicClient.estimateGas({
        to: executorAddress,
        data: calldata,
        account,
      });
      gasEstimate = Number(gas);
    } catch (e) {
      // Use estimated gas from plan
    }
    
    return {
      success: true,
      result,
      gasEstimate,
      calldata,
      formattedCalls,
      flashloanToken: plan.flashloanToken,
      flashloanAssets: plan.flashloanAssets,
      estimatedProfit: plan.estimatedProfit,
    };
    
  } catch (error) {
    // Check if we have raw revert data from our eth_call attempt
    let rawData = error.rawRevertData;
    let revertReason = error.originalError?.shortMessage || error.shortMessage || error.message;
    
    // Debug output
    console.log(`    [DEBUG] rawRevertData: ${rawData?.slice(0, 200)}`);
    
    if (!rawData) {
      // Fallback: try to find raw data from viem error structure
      rawData = error.cause?.data || error.data || error.cause?.cause?.data;
      console.log(`    [DEBUG] fallback rawData: ${rawData?.slice(0, 200)}`);
    }
    
    // Try to decode CallFailed error (0x5c0dee5d)
    if (rawData && typeof rawData === 'string' && rawData.length > 10) {
      const callFailedSelector = '5c0dee5d';
      const rawLower = rawData.toLowerCase();
      
      if (rawLower.includes(callFailedSelector)) {
        try {
          // Find where the selector starts
          const selectorPos = rawLower.indexOf(callFailedSelector);
          const dataStart = selectorPos + 8; // Skip the 8 char selector
          const data = rawData.slice(dataStart);
          
          console.log(`    [DEBUG] CallFailed payload length: ${data.length}`);
          
          if (data.length >= 64) {
            // First 32 bytes (64 hex chars) = index
            const indexHex = data.slice(0, 64);
            const callIndex = parseInt(indexHex, 16);
            
            const callNames = ['Approve Morpho', 'Liquidate', 'Approve Router', 'Swap'];
            const callName = callNames[callIndex] || `Unknown`;
            
            // Try to extract nested reason
            let nestedReason = '';
            if (data.length > 128) {
              try {
                // Offset to bytes data (next 32 bytes)
                const offsetHex = data.slice(64, 128);
                const offset = parseInt(offsetHex, 16) * 2;
                
                if (data.length > offset + 64) {
                  // Length of bytes (32 bytes at offset)
                  const lengthHex = data.slice(offset, offset + 64);
                  const length = parseInt(lengthHex, 16) * 2;
                  
                  // The actual bytes data
                  const reasonHex = data.slice(offset + 64, offset + 64 + Math.min(length, 500));
                  if (reasonHex.length > 0) {
                    // Try to decode as Error(string) if it starts with 08c379a0
                    if (reasonHex.toLowerCase().startsWith('08c379a0') && reasonHex.length >= 136) {
                      const strLength = parseInt(reasonHex.slice(72, 136), 16) * 2;
                      const strHex = reasonHex.slice(136, 136 + Math.min(strLength, 200));
                      const decoded = Buffer.from(strHex, 'hex').toString('utf8').replace(/\0/g, '');
                      nestedReason = `: "${decoded}"`;
                    } else {
                      nestedReason = `: 0x${reasonHex.slice(0, 64)}${reasonHex.length > 64 ? '...' : ''}`;
                    }
                  }
                }
              } catch (e) {
                console.log(`    [DEBUG] Nested decode error: ${e.message}`);
              }
            }
            
            revertReason = `CallFailed at step ${callIndex} [${callName}]${nestedReason}`;
          }
        } catch (decodeError) {
          console.log(`    [DEBUG] CallFailed decode error: ${decodeError.message}`);
        }
      }
    }
    
    return {
      success: false,
      error: revertReason,
      gasEstimate: 0,
    };
  }
}

/**
 * Execute liquidation via flashloan executor
 * @param {Object} walletClient - Viem wallet client
 * @param {Object} publicClient - Viem public client
 * @param {Object} plan - Flashloan execution plan
 * @param {Object} config - Configuration
 * @param {Object} simulationResult - Result from simulateFlashloanCall
 * @returns {Promise<Object>} Execution result
 */
async function executeViaFlashloan(walletClient, publicClient, plan, config, simulationResult) {
  const executorAddress = config.flashloanExecutorAddress;
  const { formattedCalls, gasEstimate, flashloanToken, flashloanAssets } = simulationResult;
  
  try {
    // Check gas price if limit set
    if (config.maxFeeGwei) {
      const gasPrice = await publicClient.getGasPrice();
      const gasPriceGwei = Number(formatUnits(gasPrice, 9));
      if (gasPriceGwei > config.maxFeeGwei) {
        return {
          success: false,
          error: `Gas price ${gasPriceGwei.toFixed(2)} gwei exceeds limit ${config.maxFeeGwei} gwei`,
          skipped: true,
        };
      }
    }
    
    // Send flashloan transaction
    const hash = await walletClient.writeContract({
      address: executorAddress,
      abi: FLASHLOAN_EXECUTOR_ABI,
      functionName: 'flash_606BaXt',
      args: [
        flashloanToken,
        flashloanAssets,
        formattedCalls,
        config.treasuryAddress,
        plan.minProfit || 0n,
      ],
      gas: config.maxGas ? BigInt(config.maxGas) : BigInt(Math.ceil(gasEstimate * 1.3)),
    });
    
    console.log(`[FLASH_SENT] tx: ${hash}`);
    
    // Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 60_000, // 60 second timeout
    });
    
    if (receipt.status === 'success') {
      return {
        success: true,
        hash,
        receipt,
        gasUsed: Number(receipt.gasUsed),
        blockNumber: Number(receipt.blockNumber),
        mode: 'flashloan',
      };
    } else {
      return {
        success: false,
        hash,
        receipt,
        error: 'Transaction reverted',
        mode: 'flashloan',
      };
    }
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      hash: error.hash,
      mode: 'flashloan',
    };
  }
}

/**
 * Dispatch execution based on mode
 * @param {Object} walletClient - Viem wallet client
 * @param {Object} publicClient - Viem public client
 * @param {Object} plan - Execution plan
 * @param {Object} config - Configuration
 * @param {Object} simulationResult - Simulation result
 * @returns {Promise<Object>} Execution result
 */
async function dispatchExecution(walletClient, publicClient, plan, config, simulationResult) {
  if (config.executionMode === 'flashloan') {
    return executeViaFlashloan(walletClient, publicClient, plan, config, simulationResult);
  }
  return executeViaExecutor(walletClient, publicClient, plan, config, simulationResult);
}

/**
 * Dispatch simulation based on mode
 * @param {Object} publicClient - Viem public client
 * @param {Object} plan - Execution plan
 * @param {Object} config - Configuration
 * @returns {Promise<Object>} Simulation result
 */
async function dispatchSimulation(publicClient, plan, config) {
  if (config.executionMode === 'flashloan' || plan.mode === 'flashloan') {
    return simulateFlashloanCall(publicClient, plan, config);
  }
  return simulateExecutorCall(publicClient, plan, config);
}

module.exports = {
  createExecutionClients,
  verifyExecutorOwnership,
  verifyFlashloanExecutor,
  simulateExecutorCall,
  simulateFlashloanCall,
  dispatchSimulation,
  executeViaExecutor,
  executeViaFlashloan,
  dispatchExecution,
  calculateActualProfit,
  formatExecutionResult,
  EXECUTOR_ABI,
  FLASHLOAN_EXECUTOR_ABI,
};
