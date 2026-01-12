const { ethers } = require("ethers");

// HyperLend oracle address for xHYPE/USDC
const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS || '0x896970EB7FB914eFcDfaDA4CFFC3E3C31497Da5a';

const ORACLE_ABI = [
    "function getPrices() view returns (bool _isBadData, uint256 _priceLow, uint256 _priceHigh)",
    "function ORACLE_PRECISION() view returns (uint128)",
    "function BASE_TOKEN() view returns (address)",
    "function QUOTE_TOKEN() view returns (address)"
];

/**
 * Read ORACLE_PRECISION from oracle contract with robust type handling
 * @param {ethers.Contract} oracle - Oracle contract instance
 * @returns {Promise<bigint>} Precision as bigint
 */
async function readOraclePrecision(oracle) {
    try {
        const p = await oracle.ORACLE_PRECISION();
        if (typeof p === "bigint") return p;
        if (typeof p === "number") return BigInt(p);
        if (typeof p === "string") return BigInt(p);
        // ethers v5 BigNumber-like:
        if (p && typeof p.toString === "function") return BigInt(p.toString());
        throw new Error("Unsupported ORACLE_PRECISION type");
    } catch (e) {
        return 10n ** 18n; // last-resort fallback
    }
}

/**
 * Format price to string with 6 decimals
 * @param {bigint} price - Price in raw units
 * @param {bigint} precision - Precision divisor
 * @returns {string} Formatted price string with 6 decimals
 */
function formatPrice(price, precision) {
    // Calculate human price: price / precision
    const human = Number(price) / Number(precision);
    return human.toFixed(6);
}

/**
 * Get oracle price band in USDC per xHYPE
 * @returns {Promise<Object>} Oracle band data
 */
async function getOracleBandUsdcPerXHype() {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.RPC);
    const oracle = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, provider);
    const debug = process.env.ORACLE_DEBUG === '1';
    
    try {
        // Call getPrices()
        const [_isBadData, _priceLow, _priceHigh] = await oracle.getPrices();
        
        // Read precision with robust type handling
        const oraclePrecision = await readOraclePrecision(oracle);
        
        // Convert prices to BigInt
        const low = BigInt(_priceLow);
        const high = BigInt(_priceHigh);
        
        // Oracle stores prices with additional scaling for token decimals
        // BASE_TOKEN (xHYPE) = 18 decimals, QUOTE_TOKEN (USDC) = 6 decimals
        // Effective precision = ORACLE_PRECISION (1e18) * 10^(BASE_DECIMALS - QUOTE_DECIMALS) = 1e18 * 1e12 = 1e30
        const decimalDiff = 18n - 6n; // xHYPE (18) - USDC (6)
        const effectivePrecision = oraclePrecision * (10n ** decimalDiff);
        
        // Debug logging
        if (debug) {
            console.log(`[ORACLE_DEBUG] ORACLE_PRECISION: ${oraclePrecision.toString()}`);
            console.log(`[ORACLE_DEBUG] Effective precision (1e30): ${effectivePrecision.toString()}`);
            console.log(`[ORACLE_DEBUG] Raw low: ${low.toString()}, high: ${high.toString()}`);
        }
        
        // Convert to human numbers (USDC per xHYPE)
        // Formula: human_price = priceRaw / effectivePrecision
        const lowHuman = Number(low) / Number(effectivePrecision);
        const highHuman = Number(high) / Number(effectivePrecision);
        const midHuman = (lowHuman + highHuman) / 2;
        
        if (debug) {
            console.log(`[ORACLE_DEBUG] Computed low: ${lowHuman.toFixed(6)}, high: ${highHuman.toFixed(6)}`);
        }
        
        return {
            ok: true,
            isBadData: _isBadData,
            lowRaw: low,
            highRaw: high,
            precision: effectivePrecision,
            low: lowHuman,
            high: highHuman,
            mid: midHuman,
            lowStr: formatPrice(low, effectivePrecision),
            highStr: formatPrice(high, effectivePrecision)
        };
    } catch (error) {
        throw new Error(`Failed to get oracle band: ${error.message}`);
    }
}

module.exports = {
    getOracleBandUsdcPerXHype,
    ORACLE_ADDRESS
};
