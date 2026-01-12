const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const { extractCandidatesFromCsv } = require("./csvCandidates");
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
 * Get liquidatable candidates for the isolated pair
 * Priority: CSV export (if CANDIDATES_CSV_PATH set) > candidates.json fallback
 */
async function getCandidates() {
    // Priority A: CSV export if CANDIDATES_CSV_PATH is set
    const csvPath = process.env.CANDIDATES_CSV_PATH;
    if (csvPath) {
        try {
            const resolvedPath = path.resolve(csvPath);
            if (fs.existsSync(resolvedPath)) {
                const candidates = extractCandidatesFromCsv(resolvedPath);
                
                if (candidates.length > 0) {
                    // Write candidates.json
                    const checksummedPair = ethers.getAddress(PAIR_ADDRESS);
                    const output = {
                        generatedAt: new Date().toISOString(),
                        pair: checksummedPair,
                        source: "csv_export",
                        candidates: candidates
                    };
                    fs.writeFileSync(CANDIDATES_PATH, JSON.stringify(output, null, 2) + '\n');
                    
                    console.log(`CSV export: extracted ${candidates.length} candidates from ${resolvedPath}`);
                    return candidates;
                } else {
                    console.log(`CSV export: no candidates found in ${resolvedPath}`);
                }
            } else {
                console.log(`CSV file not found: ${resolvedPath}`);
            }
        } catch (error) {
            console.log(`CSV export failed (${error.message}), falling back to candidates.json`);
        }
    }
    
    // Fallback: candidates.json
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
 * Check if a borrower is liquidatable by comparing spot price to liquidation price
 * @param {string} borrower - Borrower address
 * @param {number|null} spotPrice - Cached spot price (USDC per xHYPE), or null if unavailable
 * @returns {Object} { ok: boolean, liquidatable: boolean, spotPrice?: number, liquidationPrice?: number, threshold?: number, reason?: string, error?: string }
 */
async function isLiquidatableWithSpot(borrower, spotPrice) {
    try {
        // If spot price is not available, cannot determine liquidatability
        if (spotPrice === null || spotPrice === undefined) {
            return { ok: false, error: "no spot price" };
        }
        
        // Get liquidation price from SDK
        const { liquidationPrice } = await sdkGetUserLiquidationPrice(PAIR_ADDRESS, borrower);
        
        if (!liquidationPrice || liquidationPrice <= 0) {
            return { ok: true, liquidatable: false, reason: "no_liq_price" };
        }
        
        // Buffer: require spot <= liqPrice * (1 - buffer)
        // e.g., if buffer = 50 bps (0.5%), threshold = liqPrice * 0.995
        const buffer = (10000 - LIQ_BUFFER_BPS) / 10000;
        const threshold = liquidationPrice * buffer;
        
        const liquidatable = spotPrice <= threshold;
        
        return { 
            ok: true, 
            liquidatable, 
            spotPrice, 
            liquidationPrice, 
            threshold 
        };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

/**
 * Legacy function for backward compatibility - uses cached spot price
 * @deprecated Use isLiquidatableWithSpot instead
 */
async function isLiquidatable(borrower) {
    // This should not be called directly anymore - spot price must be passed
    return { ok: false, error: "isLiquidatable requires spot price - use isLiquidatableWithSpot" };
}

module.exports = {
    getCandidates,
    getBorrowShares,
    writeCandidatesJson,
    isLiquidatableWithSpot,
    isLiquidatable // kept for compatibility but deprecated
};
