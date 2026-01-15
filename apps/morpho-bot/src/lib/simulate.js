/**
 * Simulation logic for liquidation plans
 * Validates execution feasibility without sending transactions
 */

const { parseAbi } = require('viem');

// ERC20 ABI for balance checks
const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
]);

/**
 * Simulate individual call
 * @param {Object} client - Viem public client
 * @param {string} from - Sender address (executor)
 * @param {Object} call - Call object {target, value, data}
 * @returns {Promise<Object>} Simulation result {success, gasUsed, error}
 */
async function simulateCall(client, from, call) {
  try {
    const result = await client.call({
      account: from,
      to: call.target,
      data: call.data,
      value: call.value || 0n,
    });
    
    return {
      success: true,
      result: result.data,
      gasUsed: Number(result.gasUsed || 0n),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      gasUsed: 0,
    };
  }
}

/**
 * Simulate liquidation plan
 * Tests if the plan would succeed without state changes
 * @param {Object} client - Viem public client
 * @param {Object} plan - Execution plan from encodePlan
 * @param {string} executorAddress - Address that would execute (for simulation)
 * @returns {Promise<Object>} Simulation summary
 */
async function simulatePlan(client, plan, executorAddress) {
  const results = {
    planValid: false,
    callResults: [],
    totalGasEstimate: plan.estimatedGas,
    profitEstimate: null,
    errors: [],
  };
  
  // For Milestone 2, we do simplified simulation:
  // 1. Check if liquidation call would succeed (simulate just the liquidation)
  // 2. Use route expectedOut for profit estimation (not full atomic simulation)
  
  try {
    // Simulate liquidation call
    const liquidationCall = plan.calls.find(c => 
      c.data && (c.data.includes('0x7d8731d2') || c.target === plan.liquidation.marketParams.collateralToken)
    );
    
    if (liquidationCall) {
      const liquidationResult = await simulateCall(client, executorAddress, liquidationCall);
      results.callResults.push({
        type: 'liquidation',
        success: liquidationResult.success,
        gasUsed: liquidationResult.gasUsed,
        error: liquidationResult.error,
      });
      
      if (!liquidationResult.success) {
        results.errors.push(`Liquidation would fail: ${liquidationResult.error}`);
      }
    }
    
    // Estimate profit based on route
    if (plan.route) {
      const { repayAssets, seizeAssets } = plan.liquidation;
      const expectedOut = plan.route.expectedOut;
      
      // Rough profit = (collateral sold for loan tokens) - (loan tokens repaid)
      // This assumes 1:1 or uses the route's expected output
      const profitAssets = expectedOut > repayAssets ? expectedOut - repayAssets : 0n;
      
      results.profitEstimate = {
        repayAssets,
        seizeAssets,
        swapOutput: expectedOut,
        grossProfit: profitAssets,
        gasEstimate: results.totalGasEstimate,
        // Net profit = gross - gas cost (would need gas price to calculate in USD)
      };
    }
    
    // Mark plan as valid if no critical errors
    results.planValid = results.errors.length === 0;
    
  } catch (error) {
    results.errors.push(`Simulation error: ${error.message}`);
  }
  
  return results;
}

/**
 * Batch simulate multiple plans
 * @param {Object} client - Viem public client
 * @param {Array} plans - Array of execution plans
 * @param {string} executorAddress - Executor address
 * @param {number} maxSimulations - Maximum to simulate
 * @returns {Promise<Array>} Array of simulation results
 */
async function batchSimulate(client, plans, executorAddress, maxSimulations = 25) {
  const results = [];
  const toSimulate = plans.slice(0, maxSimulations);
  
  for (const plan of toSimulate) {
    const result = await simulatePlan(client, plan, executorAddress);
    results.push({
      ...result,
      liquidation: plan.liquidation,
      route: plan.route,
    });
  }
  
  return results;
}

/**
 * Check if simulation result is profitable
 * @param {Object} simulationResult - Result from simulatePlan
 * @param {number} minProfitUsd - Minimum profit in USD (optional)
 * @returns {boolean} True if profitable
 */
function isProfitable(simulationResult, minProfitUsd = 0) {
  if (!simulationResult.profitEstimate) {
    return false;
  }
  
  const { grossProfit } = simulationResult.profitEstimate;
  
  // For Milestone 2, we just check if grossProfit > 0
  // In Milestone 3, we'd convert to USD and compare with minProfitUsd
  return grossProfit > 0n;
}

module.exports = {
  simulateCall,
  simulatePlan,
  batchSimulate,
  isProfitable,
};
