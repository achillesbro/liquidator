/**
 * CLI reporting and formatting utilities
 */

/**
 * Format and print the bot report
 * @param {Object} data - Report data
 * @param {Array} data.vaults - Array of vault objects
 * @param {Array<string>} data.markets - Array of market IDs
 * @param {Array} data.positions - Array of liquidatable position objects
 * @param {number} maxPositionsPrint - Maximum positions to print
 */
function printReport(data, maxPositionsPrint) {
  const { vaults, markets, positions } = data;
  
  console.log('\n' + '='.repeat(60));
  console.log('MORPHO BOT · HYPEREVM · MILESTONE 1');
  console.log('='.repeat(60));
  console.log(`Vaults: ${vaults.length} | Markets: ${markets.length} | Liquidatable positions: ${positions.length}`);
  console.log('='.repeat(60));
  
  if (positions.length === 0) {
    console.log('\n✓ No liquidatable positions found.');
    return;
  }
  
  console.log('\nLiquidatable Positions:');
  console.log('-'.repeat(60));
  
  const positionsToPrint = positions.slice(0, maxPositionsPrint);
  
  positionsToPrint.forEach((pos, idx) => {
    const parts = [
      `[${idx + 1}]`,
      `marketId=${truncateHex(pos.marketId)}`,
      `user=${truncateAddress(pos.user)}`,
    ];
    
    if (pos.loanToken) {
      parts.push(`loan=${truncateAddress(pos.loanToken)}`);
    }
    
    if (pos.collateralToken) {
      parts.push(`collateral=${truncateAddress(pos.collateralToken)}`);
    }
    
    if (pos.seizableCollateral !== undefined) {
      parts.push(`seizable=${formatBigInt(pos.seizableCollateral)}`);
    }
    
    if (pos.repaidShares !== undefined) {
      parts.push(`repaidShares=${formatBigInt(pos.repaidShares)}`);
    }
    
    if (pos.borrowShares !== undefined) {
      parts.push(`borrowShares=${formatBigInt(pos.borrowShares)}`);
    }
    
    console.log(parts.join(' '));
  });
  
  if (positions.length > maxPositionsPrint) {
    console.log(`\n(+${positions.length - maxPositionsPrint} more positions not shown)`);
  }
  
  console.log('\n' + '='.repeat(60));
}

/**
 * Truncate a hex string for display
 * @param {string} hex - Hex string
 * @returns {string} Truncated hex
 */
function truncateHex(hex) {
  if (!hex) return 'N/A';
  if (hex.length <= 10) return hex;
  return `${hex.slice(0, 6)}...${hex.slice(-4)}`;
}

/**
 * Truncate an address for display
 * @param {string} address - Ethereum address
 * @returns {string} Truncated address
 */
function truncateAddress(address) {
  if (!address) return 'N/A';
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format a BigInt value for display
 * @param {string|number|bigint} value - Value to format
 * @returns {string} Formatted value
 */
function formatBigInt(value) {
  if (value === undefined || value === null) return 'N/A';
  
  // Handle string with 'n' suffix (from Ponder)
  if (typeof value === 'string' && value.endsWith('n')) {
    value = value.slice(0, -1);
  }
  
  try {
    const num = BigInt(value);
    return num.toString();
  } catch {
    return String(value);
  }
}

module.exports = { printReport };
