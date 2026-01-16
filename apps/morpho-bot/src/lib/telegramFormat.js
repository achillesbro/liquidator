/**
 * Telegram message formatting helpers
 * Milestone 3-4: Industrial operator console style (EREBUS)
 */

const { formatUnits } = require('viem');

/**
 * Escape HTML special characters
 * @param {string} str - String to escape
 * @returns {string} HTML-escaped string
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate HyperEVMScan transaction URL
 * @param {string} hash - Transaction hash
 * @returns {string} Full URL
 */
function txUrl(hash) {
  if (!hash) return '';
  return `https://hyperevmscan.io/tx/${hash}`;
}

/**
 * Generate HyperEVMScan address URL
 * @param {string} address - Address
 * @returns {string} Full URL
 */
function addressUrl(address) {
  if (!address) return '';
  return `https://hyperevmscan.io/address/${address}`;
}

/**
 * Format address for display (shortened)
 * @param {string} address - Full address
 * @returns {string} Shortened address
 */
function shortenAddress(address) {
  if (!address) return 'N/A';
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format market ID for display (shortened)
 * @param {string} marketId - Full market ID
 * @returns {string} Shortened market ID
 */
function shortenMarketId(marketId) {
  if (!marketId) return 'N/A';
  if (marketId.length <= 16) return marketId;
  return `${marketId.slice(0, 8)}...${marketId.slice(-8)}`;
}

/**
 * Format success notification (industrial style)
 * @param {Object} params - Success parameters
 * @param {number} params.chainId - Chain ID
 * @param {string} params.mode - Execution mode ('PREFUND' or 'FLASHLOAN')
 * @param {string} params.marketId - Market ID
 * @param {string} params.user - User address
 * @param {string} params.loanToken - Loan token symbol
 * @param {string} params.collateralToken - Collateral token symbol
 * @param {bigint} params.repayAssets - Repay amount
 * @param {number} params.loanDecimals - Loan token decimals
 * @param {Object} params.profitAssets - Profit info { profit: bigint, profitable: boolean }
 * @param {string} params.txHash - Transaction hash
 * @returns {string} Formatted HTML message
 */
function formatSuccess({ chainId, mode, marketId, user, loanToken, collateralToken, repayAssets, loanDecimals, profitAssets, txHash }) {
  const lines = [];
  
  // Header
  lines.push('<b>EREBUS // OP COMPLETE</b>');
  const modeUpper = (mode || 'UNKNOWN').toUpperCase();
  const chainIdStr = chainId !== undefined ? `CHAIN=${chainId}` : '';
  lines.push(`<code>LIQUIDATION · ${modeUpper}${chainIdStr ? ' · ' + chainIdStr : ''}</code>`);
  lines.push('');
  
  // Body
  if (user) {
    const shortUser = escapeHtml(shortenAddress(user));
    lines.push(`<b>TARGET</b>  <code>${shortUser}</code>`);
  }
  
  if (marketId) {
    const shortMarket = escapeHtml(shortenMarketId(marketId));
    lines.push(`<b>MARKET</b>  <code>${shortMarket}</code>`);
  }
  
  if (collateralToken && loanToken) {
    const collTokenEscaped = escapeHtml(collateralToken);
    const loanTokenEscaped = escapeHtml(loanToken);
    lines.push(`<b>ROUTE</b>   <code>${collTokenEscaped} → ${loanTokenEscaped}</code>`);
  }
  
  // Amounts
  if (profitAssets && profitAssets.profit !== undefined) {
    const decimals = loanDecimals || 18;
    const profitStr = formatUnits(profitAssets.profit, decimals);
    const sign = profitAssets.profit >= 0n ? '+' : '';
    const loanTokenEscaped = escapeHtml(loanToken || '');
    
    let deltaLine = `<b>DELTA</b>   <code>${sign}${profitStr} ${loanTokenEscaped}</code>`;
    
    if (repayAssets !== undefined) {
      const repayStr = formatUnits(repayAssets, decimals);
      deltaLine += `  <code>(repay ${repayStr} ${loanTokenEscaped})</code>`;
    }
    
    lines.push(deltaLine);
  } else if (repayAssets !== undefined) {
    const decimals = loanDecimals || 18;
    const repayStr = formatUnits(repayAssets, decimals);
    const loanTokenEscaped = escapeHtml(loanToken || '');
    lines.push(`<b>REPAY</b>   <code>${repayStr} ${loanTokenEscaped}</code>`);
  }
  
  // TX link
  if (txHash) {
    const shortHash = `${txHash.slice(0, 6)}…${txHash.slice(-6)}`;
    const url = txUrl(txHash);
    lines.push(`<b>TX</b>      <a href="${url}">${shortHash}</a>`);
  }
  
  return lines.join('\n');
}

/**
 * Format sent notification (tx broadcast) - industrial style
 * @param {Object} params - Sent parameters
 * @param {number} params.chainId - Chain ID
 * @param {string} params.mode - Execution mode
 * @param {string} params.marketId - Market ID
 * @param {string} params.user - User address
 * @param {string} params.loanToken - Loan token symbol
 * @param {string} params.collateralToken - Collateral token symbol
 * @param {string} params.txHash - Transaction hash
 * @returns {string} Formatted HTML message
 */
function formatSent({ chainId, mode, marketId, user, loanToken, collateralToken, txHash }) {
  const lines = [];
  
  // Header
  lines.push('<b>EREBUS // TX SENT</b>');
  const modeUpper = (mode || 'UNKNOWN').toUpperCase();
  const chainIdStr = chainId !== undefined ? `CHAIN=${chainId}` : '';
  lines.push(`<code>LIQUIDATION · ${modeUpper}${chainIdStr ? ' · ' + chainIdStr : ''}</code>`);
  lines.push('');
  
  // Body
  if (user) {
    const shortUser = escapeHtml(shortenAddress(user));
    lines.push(`<b>TARGET</b>  <code>${shortUser}</code>`);
  }
  
  if (marketId) {
    const shortMarket = escapeHtml(shortenMarketId(marketId));
    lines.push(`<b>MARKET</b>  <code>${shortMarket}</code>`);
  }
  
  if (collateralToken && loanToken) {
    const collTokenEscaped = escapeHtml(collateralToken);
    const loanTokenEscaped = escapeHtml(loanToken);
    lines.push(`<b>ROUTE</b>   <code>${collTokenEscaped} → ${loanTokenEscaped}</code>`);
  }
  
  // TX link
  if (txHash) {
    const shortHash = `${txHash.slice(0, 6)}…${txHash.slice(-6)}`;
    const url = txUrl(txHash);
    lines.push(`<b>TX</b>      <a href="${url}">${shortHash}</a>`);
  }
  
  return lines.join('\n');
}

/**
 * Format failure notification (industrial style)
 * @param {Object} params - Failure parameters
 * @param {string} params.reason - Failure reason
 * @param {string} params.txHash - Transaction hash (optional)
 * @param {string} params.marketId - Market ID (optional)
 * @param {string} params.user - User address (optional)
 * @param {string} params.mode - Execution mode (optional)
 * @param {number} params.chainId - Chain ID (optional)
 * @param {string} params.loanToken - Loan token symbol (optional)
 * @param {string} params.collateralToken - Collateral token symbol (optional)
 * @returns {string} Formatted HTML message
 */
function formatFail({ reason, txHash, marketId, user, mode, chainId, loanToken, collateralToken }) {
  const lines = [];
  
  // Header
  lines.push('<b>EREBUS // OP FAILED</b>');
  
  const headerParts = ['LIQUIDATION'];
  if (mode) {
    headerParts.push(mode.toUpperCase());
  }
  if (chainId !== undefined) {
    headerParts.push(`CHAIN=${chainId}`);
  }
  
  if (headerParts.length > 1) {
    lines.push(`<code>${headerParts.join(' · ')}</code>`);
  }
  lines.push('');
  
  // Reason (truncate to 300 chars)
  const reasonEscaped = escapeHtml(reason || 'Unknown');
  const reasonTruncated = reasonEscaped.length > 300 
    ? reasonEscaped.slice(0, 300) + '…'
    : reasonEscaped;
  lines.push(`<b>REASON</b>  <code>${reasonTruncated}</code>`);
  
  // Optional details
  if (user) {
    const shortUser = escapeHtml(shortenAddress(user));
    lines.push(`<b>TARGET</b>  <code>${shortUser}</code>`);
  }
  
  if (marketId) {
    const shortMarket = escapeHtml(shortenMarketId(marketId));
    lines.push(`<b>MARKET</b>  <code>${shortMarket}</code>`);
  }
  
  if (collateralToken && loanToken) {
    const collTokenEscaped = escapeHtml(collateralToken);
    const loanTokenEscaped = escapeHtml(loanToken);
    lines.push(`<b>ROUTE</b>   <code>${collTokenEscaped} → ${loanTokenEscaped}</code>`);
  }
  
  // TX link
  if (txHash) {
    const shortHash = `${txHash.slice(0, 6)}…${txHash.slice(-6)}`;
    const url = txUrl(txHash);
    lines.push(`<b>TX</b>      <a href="${url}">${shortHash}</a>`);
  }
  
  return lines.join('\n');
}

module.exports = {
  formatSuccess,
  formatSent,
  formatFail,
  shortenAddress,
  shortenMarketId,
  escapeHtml,
  txUrl,
  addressUrl,
};

/*
 * EXAMPLE OUTPUTS:
 * 
 * FLASHLOAN SUCCESS:
 * <b>EREBUS // OP COMPLETE</b>
 * <code>LIQUIDATION · FLASHLOAN · CHAIN=999</code>
 * 
 * <b>TARGET</b>  <code>0xabcd...efab</code>
 * <b>MARKET</b>  <code>0x1234567...12345678</code>
 * <b>ROUTE</b>   <code>WETH → USDC</code>
 * <b>DELTA</b>   <code>+50.0 USDC</code>  <code>(repay 1000.0 USDC)</code>
 * <b>TX</b>      <a href="https://hyperevmscan.io/tx/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">0xaaaa…aaaaaa</a>
 * 
 * FLASHLOAN FAIL:
 * <b>EREBUS // OP FAILED</b>
 * <code>LIQUIDATION · FLASHLOAN · CHAIN=999</code>
 * 
 * <b>REASON</b>  <code>Transaction reverted</code>
 * <b>TARGET</b>  <code>0xabcd...efab</code>
 * <b>MARKET</b>  <code>0x1234567...12345678</code>
 * <b>ROUTE</b>   <code>WETH → USDC</code>
 * <b>TX</b>      <a href="https://hyperevmscan.io/tx/0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb">0xbbbb…bbbbbb</a>
 */
