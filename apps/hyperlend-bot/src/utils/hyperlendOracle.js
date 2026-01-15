const { ethers } = require("ethers");

// HyperLend oracle address for xHYPE/USDC (legacy, kept for backward compatibility)
const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS || '0x896970EB7FB914eFcDfaDA4CFFC3E3C31497Da5a';

const ORACLE_ABI = [
    "function getPrices() view returns (bool _isBadData, uint256 _priceLow, uint256 _priceHigh)",
    "function ORACLE_PRECISION() view returns (uint128)",
    "function BASE_TOKEN() view returns (address)",
    "function QUOTE_TOKEN() view returns (address)"
];

// Fixed-point precision for prices (18 decimals)
const PRICE_DECIMALS = 18;
const PRICE_SCALE = 10n ** BigInt(PRICE_DECIMALS);
const PRICE_SCALE_SQ = PRICE_SCALE * PRICE_SCALE; // For inversion

// Cache for oracle precision per oracle address
const oraclePrecisionCache = new Map();

/**
 * Convert decimal string to BigInt fixed-point (e.g. "1.5" with 18 decimals -> 1500000000000000000n)
 * @param {string} decimalStr - Decimal string (e.g. "1.5", "0.123")
 * @param {number} decimals - Number of decimal places (default 18)
 * @returns {bigint} Fixed-point BigInt
 */
function parseDecimalToBigint(decimalStr, decimals = PRICE_DECIMALS) {
    if (!decimalStr || decimalStr === '0' || decimalStr === '') return 0n;
    
    const parts = decimalStr.split('.');
    const integerPart = parts[0] || '0';
    const fractionalPart = parts[1] || '';
    
    // Pad fractional part to desired decimals, then truncate
    const fractionalPadded = fractionalPart.padEnd(decimals, '0').slice(0, decimals);
    
    const integer = BigInt(integerPart);
    const fractional = BigInt(fractionalPadded || '0');
    const scale = 10n ** BigInt(decimals);
    
    return integer * scale + fractional;
}

/**
 * Convert BigInt fixed-point to decimal string
 * @param {bigint} valueFP - Fixed-point value (value * PRICE_SCALE, e.g. 1500000000000000000n for 1.5)
 * @param {bigint} scale - Scale factor (typically PRICE_SCALE = 10^18)
 * @param {number} displayDecimals - Number of decimals to display (default 18)
 * @returns {string} Decimal string
 */
function toDecimalString(valueFP, scale, displayDecimals = PRICE_DECIMALS) {
    if (valueFP === 0n) return '0';
    
    const scaleValue = scale;
    const remainder = valueFP % scaleValue;
    const integerPart = valueFP / scaleValue;
    
    // Handle fractional part
    const fractionalScale = 10n ** BigInt(displayDecimals);
    const fractionalRaw = (remainder * fractionalScale) / scaleValue;
    let fractionalStr = fractionalRaw.toString().padStart(displayDecimals, '0');
    
    // Remove trailing zeros
    fractionalStr = fractionalStr.replace(/0+$/, '');
    
    if (fractionalStr === '') {
        return integerPart.toString();
    }
    
    return `${integerPart.toString()}.${fractionalStr}`;
}

/**
 * Format price for display (18 decimals, with scientific notation hint for very small values)
 * @param {bigint} priceFP - Price in fixed-point (PRICE_SCALE = 1)
 * @returns {string} Formatted price string
 */
function formatPriceFP(priceFP) {
    const priceStr = toDecimalString(priceFP, PRICE_SCALE, PRICE_DECIMALS);
    
    // For very small values, show more detail
    if (priceFP > 0n && priceFP < PRICE_SCALE / 1000000n) {
        // Less than 0.000001, show full 18 decimals
        return priceStr;
    }
    
    return priceStr;
}

/**
 * Invert fixed-point price: 1 / priceFP
 * @param {bigint} priceFP - Price in fixed-point
 * @returns {bigint} Inverted price in fixed-point
 */
function invertPriceFP(priceFP) {
    if (priceFP === 0n) {
        throw new Error("Cannot invert zero price");
    }
    // 1 / price = PRICE_SCALE^2 / priceFP
    return PRICE_SCALE_SQ / priceFP;
}

/**
 * Read ORACLE_PRECISION from oracle contract with robust type handling and caching
 * @param {ethers.Contract} oracle - Oracle contract instance
 * @param {string} oracleAddress - Oracle address for caching
 * @returns {Promise<bigint>} Precision as bigint
 */
async function readOraclePrecision(oracle, oracleAddress) {
    // Check cache first
    if (oraclePrecisionCache.has(oracleAddress)) {
        return oraclePrecisionCache.get(oracleAddress);
    }
    
    try {
        const p = await oracle.ORACLE_PRECISION();
        let precision;
        if (typeof p === "bigint") precision = p;
        else if (typeof p === "number") precision = BigInt(p);
        else if (typeof p === "string") precision = BigInt(p);
        // ethers v5 BigNumber-like:
        else if (p && typeof p.toString === "function") precision = BigInt(p.toString());
        else throw new Error("Unsupported ORACLE_PRECISION type");
        
        // Cache it
        oraclePrecisionCache.set(oracleAddress, precision);
        return precision;
    } catch (e) {
        const fallback = 10n ** 18n;
        oraclePrecisionCache.set(oracleAddress, fallback);
        return fallback;
    }
}

/**
 * Fetch oracle price band for a market using oracle's own precision and base/quote orientation
 * All prices stored as fixed-point BigInt (PRICE_DECIMALS=18)
 * @param {string} oracleAddress - Oracle contract address
 * @param {string} collateralToken - Collateral token address (expected to be BASE_TOKEN)
 * @param {string} assetToken - Asset token address (expected to be QUOTE_TOKEN)
 * @returns {Promise<Object>} Oracle band data with fixed-point prices
 */
async function fetchOracleBand(oracleAddress, collateralToken, assetToken) {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.RPC);
    const oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, provider);
    const debug = process.env.ORACLE_DEBUG === '1';
    
    try {
        // Read oracle configuration
        const [baseToken, quoteToken, oraclePrecisionRaw] = await Promise.all([
            oracle.BASE_TOKEN(),
            oracle.QUOTE_TOKEN(),
            readOraclePrecision(oracle, oracleAddress)
        ]);
        
        const base = ethers.getAddress(baseToken);
        const quote = ethers.getAddress(quoteToken);
        const collateral = ethers.getAddress(collateralToken);
        const asset = ethers.getAddress(assetToken);
        
        // Read prices
        const [_isBadData, _priceLow, _priceHigh] = await oracle.getPrices();
        const lowRaw = BigInt(_priceLow);
        const highRaw = BigInt(_priceHigh);
        
        // Determine orientation
        const expected = (base === collateral && quote === asset);
        const inverted = (base === asset && quote === collateral);
        
        if (!expected && !inverted) {
            throw new Error(
                `Oracle base/quote mismatch: oracle base=${base}, quote=${quote}, ` +
                `expected collateral=${collateral}, asset=${asset}`
            );
        }
        
        // Convert raw oracle prices to fixed-point: priceFP = raw * PRICE_SCALE / ORACLE_PRECISION
        let priceLowFP, priceHighFP;
        
        if (inverted) {
            // Oracle gives asset/collateral, we need collateral/asset
            // First convert to FP, then invert: lowFP = 1/highFP, highFP = 1/lowFP
            const highFP_original = (highRaw * PRICE_SCALE) / oraclePrecisionRaw;
            const lowFP_original = (lowRaw * PRICE_SCALE) / oraclePrecisionRaw;
            
            priceLowFP = invertPriceFP(highFP_original);
            priceHighFP = invertPriceFP(lowFP_original);
            
            if (debug) {
                console.log(`[ORACLE_DEBUG] Inverted prices: oracle gives ${asset}/${collateral}, computed ${collateral}/${asset}`);
            }
        } else {
            // Oracle gives collateral/asset directly
            priceLowFP = (lowRaw * PRICE_SCALE) / oraclePrecisionRaw;
            priceHighFP = (highRaw * PRICE_SCALE) / oraclePrecisionRaw;
        }
        
        // Format for display
        const lowStr = formatPriceFP(priceLowFP);
        const highStr = formatPriceFP(priceHighFP);
        
        // Debug logging (once per market tick)
        if (debug) {
            console.log(`[ORACLE_DEBUG] Oracle: ${oracleAddress}`);
            console.log(`[ORACLE_DEBUG] Base: ${base}, Quote: ${quote}`);
            console.log(`[ORACLE_DEBUG] Collateral: ${collateral}, Asset: ${asset}`);
            console.log(`[ORACLE_DEBUG] Orientation: ${inverted ? 'INVERTED' : 'EXPECTED'}`);
            console.log(`[ORACLE_DEBUG] ORACLE_PRECISION: ${oraclePrecisionRaw.toString()}`);
            console.log(`[ORACLE_DEBUG] Raw low: ${lowRaw.toString()}, high: ${highRaw.toString()}`);
            console.log(`[ORACLE_DEBUG] Fixed-point low: ${priceLowFP.toString()}, high: ${priceHighFP.toString()}`);
            console.log(`[ORACLE_DEBUG] Computed low: ${lowStr}, high: ${highStr}`);
        }
        
        return {
            ok: true,
            badData: _isBadData,
            isBadData: _isBadData,
            // Fixed-point prices (PRICE_SCALE = 1)
            priceLowFP: priceLowFP,
            priceHighFP: priceHighFP,
            // Raw oracle values (for backward compatibility)
            priceLowRaw: lowRaw,
            priceHighRaw: highRaw,
            lowRaw: lowRaw,
            highRaw: highRaw,
            // Precision
            precision: oraclePrecisionRaw,
            oraclePrecision: oraclePrecisionRaw,
            // Formatted strings (18 decimals)
            lowStr: lowStr,
            highStr: highStr,
            // Metadata
            baseToken: base,
            quoteToken: quote,
            inverted: inverted,
            // Legacy fields (deprecated, use priceLowFP/priceHighFP)
            low: null, // No longer using Number
            high: null,
            mid: null
        };
    } catch (error) {
        throw new Error(`Failed to fetch oracle band for ${oracleAddress}: ${error.message}`);
    }
}

/**
 * Convert liquidation price string to fixed-point BigInt
 * @param {string} liquidationPriceStr - Liquidation price as string (e.g. "0.371497")
 * @returns {bigint} Fixed-point BigInt (PRICE_SCALE = 1)
 */
function liquidationPriceToFP(liquidationPriceStr) {
    if (!liquidationPriceStr || liquidationPriceStr === '0') return 0n;
    return parseDecimalToBigint(liquidationPriceStr, PRICE_DECIMALS);
}

module.exports = {
    fetchOracleBand,
    liquidationPriceToFP,
    PRICE_DECIMALS,
    PRICE_SCALE,
    parseDecimalToBigint,
    toDecimalString,
    invertPriceFP,
    ORACLE_ADDRESS
};
