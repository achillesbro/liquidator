const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const { sdkGetUserLiquidationPrice } = require("./hyperlendIsolatedSdk");
const { multicall } = require("./multicall3");

const PAIR_ADDRESS = '0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd';

const PAIR_ABI = [
    "function getUserSnapshot(address user) view returns (uint256 userAssetShares, uint256 userBorrowShares, uint256 userCollateralBalance)",
    "function toBorrowAmount(uint256 shares, bool roundUp, bool previewInterest) view returns (uint256)",
    "function maxLTV() view returns (uint256)",
    "function getConstants() pure returns (uint256 _LTV_PRECISION, uint256 _LIQ_PRECISION, uint256 _UTIL_PREC, uint256 _FEE_PRECISION, uint256 _EXCHANGE_PRECISION, uint256 _DEVIATION_PRECISION, uint256 _RATE_PRECISION, uint256 _MAX_PROTOCOL_FEE)"
];

const PAIR_MATH_ABI = [
    "function toBorrowAmount(uint256 shares, bool roundUp, bool previewInterest) view returns (uint256 amount)",
    "function maxLTV() view returns (uint256)"
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
 * Get batched snapshots for multiple borrowers using Multicall3
 * @param {string[]} borrowers - Array of borrower addresses
 * @returns {Promise<Map<string, {userBorrowShares: bigint, userCollateralBalance: bigint, userAssetShares: bigint} | null>>} Map of borrower address to snapshot
 */
async function getSnapshots(borrowers) {
    if (borrowers.length === 0) {
        return new Map();
    }

    const provider = getProvider();
    const iface = new ethers.Interface(PAIR_ABI);

    // Build calls array
    const calls = borrowers.map(borrower => ({
        target: PAIR_ADDRESS,
        callData: iface.encodeFunctionData("getUserSnapshot", [borrower]),
        allowFailure: true
    }));

    // Execute batched multicall
    let results;
    try {
        results = await multicall(provider, calls);
    } catch (error) {
        console.error(`Multicall failed: ${error.message}`);
        // Return map with all null entries on failure
        const snapshots = new Map();
        borrowers.forEach(borrower => snapshots.set(borrower, null));
        return snapshots;
    }

    // Decode results
    const snapshots = new Map();
    let hasLoggedFailure = false;

    results.forEach(({ success, returnData }, index) => {
        const borrower = borrowers[index];
        
        if (success) {
            try {
                const [userAssetShares, userBorrowShares, userCollateralBalance] = 
                    iface.decodeFunctionResult("getUserSnapshot", returnData);
                
                snapshots.set(borrower, {
                    userAssetShares,
                    userBorrowShares,
                    userCollateralBalance
                });
            } catch (decodeError) {
                if (!hasLoggedFailure) {
                    console.error(`Failed to decode snapshot for ${borrower}: ${decodeError.message}`);
                    hasLoggedFailure = true;
                }
                snapshots.set(borrower, null);
            }
        } else {
            if (!hasLoggedFailure) {
                console.error(`Failed to fetch snapshot for ${borrower} (multicall returned failure)`);
                hasLoggedFailure = true;
            }
            snapshots.set(borrower, null);
        }
    });

    return snapshots;
}

/**
 * Get borrower's borrow shares from isolated pair (legacy, single call)
 * @deprecated Use getSnapshots for batched calls instead
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

// Cache for pair static params (maxLTV, LTV_PRECISION)
let cachedPairParams = null;
let cachedPairParamsTimestamp = 0;
const PAIR_PARAMS_CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Batch fetch borrow amounts from shares using Multicall3
 * @param {string} pairAddress - Pair contract address
 * @param {Map<string, bigint>} borrowSharesByBorrower - Map of borrower address to borrow shares
 * @param {ethers.Provider} provider - Ethers provider
 * @returns {Promise<Map<string, bigint>>} Map of borrower address to borrow amount (USDC, 6 decimals)
 */
async function getBorrowAmountsFromShares(pairAddress, borrowSharesByBorrower, provider) {
    if (borrowSharesByBorrower.size === 0) {
        return new Map();
    }

    const iface = new ethers.Interface(PAIR_MATH_ABI);
    const borrowers = [];
    const calls = [];

    // Build calls array for borrowers with shares > 0
    for (const [borrower, shares] of borrowSharesByBorrower.entries()) {
        if (shares > 0n) {
            borrowers.push(borrower);
            calls.push({
                target: pairAddress,
                callData: iface.encodeFunctionData("toBorrowAmount", [shares, true, true]),
                allowFailure: true
            });
        }
    }

    if (calls.length === 0) {
        return new Map();
    }

    // Execute batched multicall
    let results;
    try {
        results = await multicall(provider, calls);
    } catch (error) {
        console.error(`Multicall failed for borrowAmounts: ${error.message}`);
        // Return map with all 0n entries on failure
        const amounts = new Map();
        borrowers.forEach(borrower => amounts.set(borrower, 0n));
        return amounts;
    }

    // Decode results
    const amounts = new Map();
    let hasLoggedFailure = false;

    results.forEach(({ success, returnData }, index) => {
        const borrower = borrowers[index];
        
        if (success) {
            try {
                const [amount] = iface.decodeFunctionResult("toBorrowAmount", returnData);
                amounts.set(borrower, amount);
            } catch (decodeError) {
                if (!hasLoggedFailure) {
                    console.error(`Failed to decode borrowAmount for ${borrower}: ${decodeError.message}`);
                    hasLoggedFailure = true;
                }
                amounts.set(borrower, 0n);
            }
        } else {
            if (!hasLoggedFailure) {
                console.error(`Failed to fetch borrowAmount for ${borrower} (multicall returned failure)`);
                hasLoggedFailure = true;
            }
            amounts.set(borrower, 0n);
        }
    });

    return amounts;
}

/**
 * Get pair static parameters (maxLTV and LTV_PRECISION) with caching
 * @param {string} pairAddress - Pair contract address
 * @param {ethers.Provider} provider - Ethers provider
 * @returns {Promise<Object>} { maxLTV: bigint, LTV_PRECISION: bigint }
 */
async function getPairStaticParams(pairAddress, provider) {
    // Check cache
    const now = Date.now();
    if (cachedPairParams && (now - cachedPairParamsTimestamp) < PAIR_PARAMS_CACHE_TTL_MS) {
        return cachedPairParams;
    }

    try {
        // Fetch maxLTV via multicall (single call)
        const iface = new ethers.Interface(PAIR_MATH_ABI);
        const calls = [
            {
                target: pairAddress,
                callData: iface.encodeFunctionData("maxLTV", []),
                allowFailure: false
            }
        ];

        const results = await multicall(provider, calls);
        const [maxLTVResult] = results;
        const [maxLTV] = iface.decodeFunctionResult("maxLTV", maxLTVResult.returnData);

        // Get LTV_PRECISION from getConstants (single call, but could be batched with maxLTV if needed)
        let ltvPrecision = 100_000n; // Default fallback
        try {
            const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
            const constants = await pair.getConstants.staticCall();
            ltvPrecision = constants[0]; // _LTV_PRECISION is first return value
        } catch (error) {
            // Use default if getConstants fails
        }

        cachedPairParams = { maxLTV, LTV_PRECISION: ltvPrecision };
        cachedPairParamsTimestamp = now;
        return cachedPairParams;
    } catch (error) {
        console.error(`Failed to fetch pair static params: ${error.message}`);
        // Return cached value if available, otherwise default
        if (cachedPairParams) {
            return cachedPairParams;
        }
        return { maxLTV: 0n, LTV_PRECISION: 100_000n };
    }
}

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
    getSnapshots,
    getBorrowShares, // kept for compatibility but deprecated - use getSnapshots instead
    getBorrowAmountsFromShares,
    getPairStaticParams,
    writeCandidatesJson,
    isLiquidatableWithOracle,
    isLiquidatableWithSpot, // kept for compatibility but deprecated
    isLiquidatable // kept for compatibility but deprecated
};
