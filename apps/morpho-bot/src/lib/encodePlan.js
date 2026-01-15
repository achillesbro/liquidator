/**
 * Encode liquidation execution plan
 * Builds sequence of calls for executor-style execution
 * Milestone 4: Flashloan execution mode support
 */

const { encodeFunctionData, parseAbi, maxUint256 } = require('viem');

// ERC20 ABI
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

// Morpho Blue liquidate ABI
const MORPHO_BLUE_ABI = parseAbi([
  'function liquidate((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, address borrower, uint256 seizedAssets, uint256 repaidShares, bytes data) returns (uint256, uint256)',
]);

/**
 * Encode approval call
 * @param {string} tokenAddress - Token to approve
 * @param {string} spender - Spender address
 * @param {bigint} amount - Amount to approve
 * @returns {Object} Call object {target, value, data}
 */
function encodeApproval(tokenAddress, spender, amount) {
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, amount],
  });
  
  return {
    target: tokenAddress,
    value: 0n,
    data,
  };
}

/**
 * Encode ERC20 transfer call
 * @param {string} tokenAddress - Token to transfer
 * @param {string} to - Recipient address
 * @param {bigint} amount - Amount to transfer
 * @returns {Object} Call object {target, value, data}
 */
function encodeTransfer(tokenAddress, to, amount) {
  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [to, amount],
  });
  
  return {
    target: tokenAddress,
    value: 0n,
    data,
  };
}

/**
 * Encode Morpho Blue liquidation call
 * 
 * IMPORTANT: Morpho Blue's liquidate() requires specifying EITHER:
 * - seizedAssets > 0 and repaidShares = 0 (specify collateral to seize)
 * - seizedAssets = 0 and repaidShares > 0 (specify debt to repay)
 * 
 * Passing both non-zero will cause a revert!
 * 
 * We use seizedAssets mode because we know exactly how much collateral
 * we want to seize and swap.
 * 
 * @param {string} morphoBlueAddress - Morpho Blue contract address
 * @param {Object} marketParams - Market parameters
 * @param {string} borrower - Borrower address
 * @param {bigint} seizedAssets - Amount of collateral to seize (use this OR repaidShares, not both)
 * @param {bigint} repaidShares - Amount of debt shares to repay (set to 0 when using seizedAssets)
 * @returns {Object} Call object {target, value, data}
 */
function encodeLiquidation(morphoBlueAddress, marketParams, borrower, seizedAssets, repaidShares = 0n) {
  // Morpho Blue requires exactly one of seizedAssets or repaidShares to be non-zero
  // We default to seizedAssets mode for predictable collateral acquisition
  const data = encodeFunctionData({
    abi: MORPHO_BLUE_ABI,
    functionName: 'liquidate',
    args: [
      marketParams,
      borrower,
      seizedAssets,
      0n, // Always pass 0 for repaidShares when specifying seizedAssets
      '0x', // Empty data for now
    ],
  });
  
  return {
    target: morphoBlueAddress,
    value: 0n,
    data,
  };
}

/**
 * Encode swap call (pre-encoded calldata from LiquidSwap)
 * @param {Object} route - Route object from LiquidSwap
 * @returns {Object} Call object {target, value, data}
 */
function encodeSwap(route) {
  return {
    target: route.execution.to,
    value: BigInt(route.execution.value || '0'),
    data: route.execution.calldata,
  };
}

/**
 * Build complete liquidation plan for simulation (Milestone 2 style)
 * @param {Object} config - Configuration
 * @param {Object} liquidation - Confirmed liquidation details
 * @param {Object} route - Swap route from LiquidSwap
 * @returns {Object} Execution plan with calls array
 */
function buildLiquidationPlan(config, liquidation, route) {
  const calls = [];
  
  // Step 1: Approve Morpho Blue to spend loan token (for repayment)
  // Note: In practice, executor would need loan tokens first (via flashloan or prefunding)
  // For simulation, we assume tokens are available
  calls.push(encodeApproval(
    liquidation.marketParams.loanToken,
    config.morphoBlueAddress,
    liquidation.repayAssets
  ));
  
  // Step 2: Execute liquidation on Morpho Blue
  // Note: We specify seizedAssets only (repaidShares = 0), Morpho calculates debt to repay
  calls.push(encodeLiquidation(
    config.morphoBlueAddress,
    liquidation.marketParams,
    liquidation.user,
    liquidation.seizeAssets
  ));
  
  // Step 3: Approve router to spend seized collateral
  if (route) {
    calls.push(encodeApproval(
      liquidation.marketParams.collateralToken,
      route.execution.to,
      liquidation.seizeAssets
    ));
    
    // Step 4: Swap seized collateral to loan token
    calls.push(encodeSwap(route));
  }
  
  return {
    calls,
    liquidation,
    route,
    estimatedGas: calculateEstimatedGas(calls, route),
  };
}

/**
 * Build executor calls for real execution (Milestone 3)
 * Prefunded mode: executor already holds loan tokens
 * @param {Object} config - Configuration
 * @param {Object} liquidation - Confirmed liquidation details
 * @param {Object} route - Swap route from LiquidSwap
 * @returns {Object} Executor call plan
 */
function buildCallsForExecutor(config, liquidation, route) {
  const calls = [];
  
  const { loanToken, collateralToken } = liquidation.marketParams;
  
  // Step 1: Approve Morpho Blue to spend loan token (for repayment)
  // Add 1% buffer since Morpho calculates exact repay amount internally based on seizedAssets
  const approvalAmount = liquidation.repayAssets + (liquidation.repayAssets / 100n);
  calls.push({
    ...encodeApproval(loanToken, config.morphoBlueAddress, approvalAmount),
    description: `Approve Morpho to spend ${approvalAmount} ${liquidation.loanSymbol}`,
  });
  
  // Step 2: Execute liquidation on Morpho Blue
  // This will transfer repayAssets from executor to Morpho, receive seizeAssets collateral
  // Note: We specify seizedAssets only (repaidShares = 0), Morpho calculates debt to repay
  calls.push({
    ...encodeLiquidation(
      config.morphoBlueAddress,
      liquidation.marketParams,
      liquidation.user,
      liquidation.seizeAssets
    ),
    description: `Liquidate ${liquidation.user.slice(0, 10)}... seize ${liquidation.seizeAssets} ${liquidation.collateralSymbol}`,
  });
  
  // Step 3: If we have a swap route, approve and swap collateral back to loan token
  if (route && route.execution) {
    // Approve swap router to spend collateral
    calls.push({
      ...encodeApproval(collateralToken, route.execution.to, liquidation.seizeAssets),
      description: `Approve LiquidSwap to spend ${liquidation.seizeAssets} ${liquidation.collateralSymbol}`,
    });
    
    // Execute swap
    calls.push({
      ...encodeSwap(route),
      description: `Swap ${liquidation.collateralSymbol} -> ${liquidation.loanSymbol} (expected: ${route.expectedOut})`,
    });
  }
  
  // Step 4: Transfer all remaining loan tokens to treasury (profit skim)
  // We use maxUint256 as a marker - actual transfer will be calculated after simulation
  // In practice, we transfer the actual balance delta
  // For now, we'll estimate based on route output
  if (route && route.expectedOut && config.treasuryAddress) {
    const estimatedProfit = route.expectedOut > liquidation.repayAssets
      ? route.expectedOut - liquidation.repayAssets
      : 0n;
    
    if (estimatedProfit > 0n) {
      calls.push({
        ...encodeTransfer(loanToken, config.treasuryAddress, estimatedProfit),
        description: `Transfer ${estimatedProfit} ${liquidation.loanSymbol} profit to treasury`,
        isProfitSkim: true,
      });
    }
  }
  
  return {
    calls,
    liquidation,
    route,
    estimatedGas: calculateEstimatedGas(calls, route),
    repayRequired: liquidation.repayAssets,
    loanToken,
    collateralToken,
  };
}

/**
 * Calculate estimated gas for execution plan
 * @param {Array} calls - Array of call objects
 * @param {Object} route - Swap route (optional)
 * @returns {number} Estimated gas
 */
function calculateEstimatedGas(calls, route) {
  let gas = 0;
  
  // Base gas per call
  gas += calls.length * 21000;
  
  // Approval calls: ~50k each
  const approvalCount = calls.filter(c => c.data && c.data.startsWith('0x095ea7b3')).length;
  gas += approvalCount * 50000;
  
  // Transfer calls: ~65k each
  const transferCount = calls.filter(c => c.data && c.data.startsWith('0xa9059cbb')).length;
  gas += transferCount * 65000;
  
  // Liquidation call: ~200k
  gas += 200000;
  
  // Swap call: from route estimate or default
  if (route && route.gas) {
    gas += route.gas;
  } else if (route) {
    gas += 150000; // Default swap gas
  }
  
  // Executor overhead
  gas += 50000;
  
  return gas;
}

/**
 * Check if executor has sufficient loan token balance
 * @param {Object} client - Viem client
 * @param {string} executorAddress - Executor contract address
 * @param {string} loanToken - Loan token address
 * @param {bigint} requiredAmount - Amount needed for liquidation
 * @returns {Promise<Object>} Balance check result
 */
async function checkExecutorBalance(client, executorAddress, loanToken, requiredAmount) {
  try {
    const balance = await client.readContract({
      address: loanToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [executorAddress],
    });
    
    const sufficient = balance >= requiredAmount;
    const shortfall = sufficient ? 0n : requiredAmount - balance;
    
    return {
      balance,
      required: requiredAmount,
      sufficient,
      shortfall,
    };
  } catch (error) {
    return {
      balance: 0n,
      required: requiredAmount,
      sufficient: false,
      shortfall: requiredAmount,
      error: error.message,
    };
  }
}

// ========================================
// Milestone 4: Flashloan Mode
// ========================================

/**
 * Calculate flashloan amount with buffer
 * @param {bigint} repayAssets - Amount needed to repay
 * @param {number} bufferBps - Buffer in basis points (e.g., 20 = 0.2%)
 * @param {bigint|null} maxAssets - Maximum flashloan cap
 * @returns {bigint} Flashloan amount
 */
function calculateFlashloanAmount(repayAssets, bufferBps = 20, maxAssets = null) {
  // Add buffer: assets = repayAssets * (1 + buffer/10000)
  const buffer = (repayAssets * BigInt(bufferBps)) / 10000n;
  let flashloanAssets = repayAssets + buffer;
  
  // Apply cap if set
  if (maxAssets !== null && flashloanAssets > maxAssets) {
    flashloanAssets = maxAssets;
  }
  
  return flashloanAssets;
}

/**
 * Build calls for flashloan callback execution
 * These calls are executed INSIDE the flashloan callback:
 * 1. Approve Morpho Blue to spend loan token (for liquidation repayment)
 * 2. Execute liquidation (receive collateral)
 * 3. Approve swap router to spend collateral
 * 4. Execute swap (collateral -> loan token)
 * 
 * Note: Profit transfer is handled by the contract callback, not as a call
 * Note: Flashloan repayment approval is handled by the contract callback
 * 
 * @param {Object} config - Configuration
 * @param {Object} liquidation - Confirmed liquidation details
 * @param {Object} route - Swap route from LiquidSwap
 * @returns {Object} Flashloan execution plan
 */
function buildCallsForFlashloan(config, liquidation, route) {
  const calls = [];
  
  const { loanToken, collateralToken } = liquidation.marketParams;
  
  // Step 1: Approve Morpho Blue to spend loan token (for liquidation repayment)
  // This is the approval for the liquidate() call to pull repayAssets
  // Add 1% buffer since Morpho calculates exact repay amount internally based on seizedAssets
  const approvalAmount = liquidation.repayAssets + (liquidation.repayAssets / 100n);
  calls.push({
    ...encodeApproval(loanToken, config.morphoBlueAddress, approvalAmount),
    description: `Approve Morpho to spend ${approvalAmount} ${liquidation.loanSymbol} for liquidation`,
  });
  
  // Step 2: Execute liquidation on Morpho Blue
  // This pulls loan tokens from executor, gives seizeAssets collateral
  // Note: We specify seizedAssets only (repaidShares = 0), Morpho calculates debt to repay
  calls.push({
    ...encodeLiquidation(
      config.morphoBlueAddress,
      liquidation.marketParams,
      liquidation.user,
      liquidation.seizeAssets
    ),
    description: `Liquidate ${liquidation.user.slice(0, 10)}... seize ${liquidation.seizeAssets} ${liquidation.collateralSymbol}`,
  });
  
  // Step 3: Approve and execute swap (collateral -> loan token)
  if (route && route.execution) {
    // Approve swap router to spend collateral
    calls.push({
      ...encodeApproval(collateralToken, route.execution.to, liquidation.seizeAssets),
      description: `Approve LiquidSwap to spend ${liquidation.seizeAssets} ${liquidation.collateralSymbol}`,
    });
    
    // Execute swap
    calls.push({
      ...encodeSwap(route),
      description: `Swap ${liquidation.collateralSymbol} -> ${liquidation.loanSymbol} (expected: ${route.expectedOut})`,
    });
  }
  
  // Note: The contract callback handles:
  // - Approving Morpho to pull flashloan repayment
  // - Transferring profit to treasury
  // - Validating minimum profit
  
  // Calculate flashloan amount with buffer
  const flashloanAssets = calculateFlashloanAmount(
    liquidation.repayAssets,
    config.flashloanBufferBps,
    config.maxFlashloanAssets
  );
  
  // Estimate profit (before gas)
  const estimatedSwapOut = route ? route.expectedOut : 0n;
  const estimatedProfit = estimatedSwapOut > flashloanAssets 
    ? estimatedSwapOut - flashloanAssets 
    : 0n;
  
  return {
    // Execution mode
    mode: 'flashloan',
    
    // Flashloan parameters
    flashloanToken: loanToken,
    flashloanAssets,
    
    // Calls to execute inside callback
    calls,
    
    // Liquidation details
    liquidation,
    route,
    
    // Profit info
    repayRequired: liquidation.repayAssets,
    estimatedSwapOut,
    estimatedProfit,
    minProfit: config.minFlashloanProfit || 0n,
    
    // Token addresses for convenience
    loanToken,
    collateralToken,
    
    // Gas estimate
    estimatedGas: calculateEstimatedGas(calls, route) + 100000, // Extra gas for flashloan overhead
  };
}

/**
 * Build execution plan based on mode
 * @param {Object} config - Configuration
 * @param {Object} liquidation - Confirmed liquidation details
 * @param {Object} route - Swap route from LiquidSwap
 * @returns {Object} Execution plan
 */
function buildExecutionPlan(config, liquidation, route) {
  if (config.executionMode === 'flashloan') {
    return buildCallsForFlashloan(config, liquidation, route);
  }
  // Default to prefund mode
  return buildCallsForExecutor(config, liquidation, route);
}

module.exports = {
  encodeApproval,
  encodeTransfer,
  encodeLiquidation,
  encodeSwap,
  buildLiquidationPlan,
  buildCallsForExecutor,
  buildCallsForFlashloan,
  buildExecutionPlan,
  calculateEstimatedGas,
  calculateFlashloanAmount,
  checkExecutorBalance,
  ERC20_ABI,
  MORPHO_BLUE_ABI,
};
