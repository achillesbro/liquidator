const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const { sdkGetUserLiquidationPrice } = require("./hyperlendIsolatedSdk");

const PAIR_ADDRESS = '0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd';

const PAIR_ABI = [
    "function getUserSnapshot(address user) view returns (uint256 userAssetShares, uint256 userBorrowShares, uint256 userCollateralBalance)"
];

const CANDIDATES_PATH = path.join(__dirname, "..", "candidates.json");

// Singleton provider for reuse
let providerInstance = null;

function getProvider() {
    if (!providerInstance) {
        providerInstance = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.RPC);
    }
    return providerInstance;
}

/**
 * Get liquidatable candidates for the isolated pair from candidates.json
 */
async function getCandidates() {
    if (fs.existsSync(CANDIDATES_PATH)) {
        const data = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));
        const candidates = Array.isArray(data) ? data : (data.candidates || []);
        return candidates
            .filter(addr => ethers.isAddress(addr))
            .map(addr => ethers.getAddress(addr));
    }
    
    console.warn("No candidates.json found, returning empty list");
    return [];
}

/**
 * Write candidates to JSON file (legacy function, kept for compatibility)
 * @param {string} outputPathOptional - Optional output path, defaults to bot/src/candidates.json
 */
async function writeCandidatesJson(outputPathOptional) {
    const candidates = await getCandidates();
    const outputPath = outputPathOptional || CANDIDATES_PATH;
    const checksummedPair = ethers.getAddress(PAIR_ADDRESS);
    
    const output = {
        generatedAt: new Date().toISOString(),
        pair: checksummedPair,
        source: "csv_export",
        candidates: candidates
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
    return output;
}

/**
 * Get borrower's borrow shares from isolated pair
 * @param {string} borrower - Borrower address
 * @returns {Object} { userBorrowShares: BigInt, userCollateralBalance?: BigInt }
 */
async function getBorrowShares(borrower) {
    const provider = getProvider();
    const pair = new ethers.Contract(PAIR_ADDRESS, PAIR_ABI, provider);
    
    try {
        const [userAssetShares, userBorrowShares, userCollateralBalance] = await pair.getUserSnapshot(borrower);
        return {
            userBorrowShares: userBorrowShares,
            userCollateralBalance: userCollateralBalance
        };
    } catch (error) {
        console.error(`Failed to get snapshot for ${borrower}:`, error.message);
        throw error;
    }
}

// Liquidation buffer in basis points (default 50 = 0.5%)
const LIQ_BUFFER_BPS = process.env.LIQ_BUFFER_BPS ? parseInt(process.env.LIQ_BUFFER_BPS) : 50;

/**
 * Check if a borrower is liquidatable by comparing oracle high price to liquidation price
 * @param {string} borrower - Borrower address
 * @param {number|null} oracleHighPrice - Cached oracle high price (USDC per xHYPE), or null if unavailable
 * @returns {Object} { ok: boolean, liquidatable: boolean, oracleHighPrice?: number, liquidationPrice?: number, threshold?: number, reason?: string, error?: string }
 */
async function isLiquidatableWithOracle(borrower, oracleHighPrice) {
    try {
        // If oracle price is not available, cannot determine liquidatability
        if (oracleHighPrice === null || oracleHighPrice === undefined) {
            return { ok: false, error: "no_oracle_price" };
        }
        
        // Get liquidation price from SDK
        const { liquidationPrice } = await sdkGetUserLiquidationPrice(PAIR_ADDRESS, borrower);
        
        if (!liquidationPrice || liquidationPrice <= 0) {
            return { ok: true, liquidatable: false, reason: "no_liq_price" };
        }
        
        // Buffer: require oracleHighPrice <= liqPrice * (1 - buffer)
        // e.g., if buffer = 50 bps (0.5%), threshold = liqPrice * 0.995
        const buffer = (10000 - LIQ_BUFFER_BPS) / 10000;
        const threshold = liquidationPrice * buffer;
        
        const liquidatable = oracleHighPrice <= threshold;
        
        return { 
            ok: true, 
            liquidatable, 
            oracleHighPrice, 
            liquidationPrice, 
            threshold 
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

/**
 * Legacy function for backward compatibility - uses cached spot price
 * @deprecated Use isLiquidatableWithOracle instead
 */
async function isLiquidatableWithSpot(borrower, spotPrice) {
    // This function is kept for compatibility but is deprecated
    // Convert spotPrice to oracleHighPrice for the new function
    return await isLiquidatableWithOracle(borrower, spotPrice);
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use isLiquidatableWithOracle instead
 */
async function isLiquidatable(borrower) {
    // This should not be called directly anymore - oracle price must be passed
    return { ok: false, error: "isLiquidatable requires oracle price - use isLiquidatableWithOracle" };
}

module.exports = {
    getCandidates,
    getBorrowShares,
    writeCandidatesJson,
    isLiquidatableWithOracle,
    isLiquidatableWithSpot, // kept for compatibility but deprecated
    isLiquidatable // kept for compatibility but deprecated
};
