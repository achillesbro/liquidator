// SDK wrapper using ethers v5 (SDK requirement) while bot uses ethers v6
// Using vendored SDK patched to use ethers5
const ethers5 = require("ethers5");
const { HyperlendSDK } = require("../vendor/hyperlend-isolated-sdk");

const PAIR_ADDRESS = '0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd';
const CHAIN_ID = 999; // HyperEVM

// Singleton SDK instance and provider
let sdkInstance = null;
let providerV5Instance = null;
let initialized = false;

/**
 * Helper: Find contracts with null providers (debugging)
 */
function findNullProviderContracts(obj, path = "obj", maxDepth = 4, visited = new WeakSet()) {
    if (maxDepth <= 0 || !obj || typeof obj !== "object") {
        return;
    }
    
    // Avoid circular references
    if (visited.has(obj)) {
        return;
    }
    visited.add(obj);
    
    try {
        // Check if this looks like an ethers Contract
        if (obj.address && obj.interface && "provider" in obj && typeof obj.connect === "function") {
            const providerIsNull = obj.provider === null || obj.provider === undefined;
            console.log(`[SDK DEBUG] Contract at ${path}: address=${obj.address}, provider is ${providerIsNull ? 'NULL' : 'SET'}`);
        }
        
        // Traverse object properties
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                try {
                    const value = obj[key];
                    if (value && typeof value === "object") {
                        findNullProviderContracts(value, `${path}.${key}`, maxDepth - 1, visited);
                    }
                } catch (e) {
                    // Skip properties that throw on access
                }
            }
        }
    } catch (e) {
        // Skip objects that throw on inspection
    }
}

/**
 * Helper: Reconnect contracts to provider (hotfix)
 */
function reconnectContracts(obj, provider, maxDepth = 4, visited = new WeakSet()) {
    if (maxDepth <= 0 || !obj || typeof obj !== "object") {
        return;
    }
    
    // Avoid circular references
    if (visited.has(obj)) {
        return;
    }
    visited.add(obj);
    
    try {
        // Check if this looks like an ethers Contract with null provider
        if (obj.address && obj.interface && "provider" in obj && typeof obj.connect === "function") {
            if (obj.provider === null || obj.provider === undefined) {
                try {
                    const reconnected = obj.connect(provider);
                    // Replace in parent if possible (this is tricky - we can't replace the original)
                    console.log(`[SDK DEBUG] Would reconnect contract at ${obj.address}, but cannot replace in-place`);
                } catch (e) {
                    console.warn(`[SDK DEBUG] Failed to reconnect contract:`, e.message);
                }
            }
        }
        
        // Traverse object properties and try to replace
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                try {
                    const value = obj[key];
                    if (value && typeof value === "object") {
                        // If it's a contract with null provider, try to reconnect
                        if (value.address && value.interface && "provider" in value && typeof value.connect === "function") {
                            if (value.provider === null || value.provider === undefined) {
                                try {
                                    obj[key] = value.connect(provider);
                                    console.log(`[SDK DEBUG] Reconnected contract at ${key} (address: ${value.address})`);
                                } catch (e) {
                                    console.warn(`[SDK DEBUG] Failed to reconnect ${key}:`, e.message);
                                }
                            } else {
                                reconnectContracts(value, provider, maxDepth - 1, visited);
                            }
                        } else {
                            reconnectContracts(value, provider, maxDepth - 1, visited);
                        }
                    }
                } catch (e) {
                    // Skip properties that throw on access
                }
            }
        }
    } catch (e) {
        // Skip objects that throw on inspection
    }
}

/**
 * Initialize SDK with ethers v5 provider (SDK requirement)
 */
async function initializeSdk() {
    if (initialized && sdkInstance) {
        return sdkInstance;
    }

    try {
        // Create ethers v5 provider if not exists
        if (!providerV5Instance) {
            const rpcUrl = process.env.RPC_URL || process.env.RPC;
            if (!rpcUrl) {
                throw new Error("RPC_URL or RPC environment variable is required");
            }
            // Create ethers v5 provider with chain configuration
            providerV5Instance = new ethers5.providers.JsonRpcProvider(rpcUrl, {
                chainId: CHAIN_ID,
                name: "hyperEvm"
            });
        }

        // Get registry address (required for SDK initialization)
        const registryAddress = process.env.REGISTRY_ADDRESS;
        if (!registryAddress) {
            throw new Error("REGISTRY_ADDRESS environment variable is required");
        }

        // Runtime checks: verify which ethers versions are being used
        if (process.env.SDK_DEBUG === '1') {
            const ethers6 = require("ethers");
            console.log(`[SDK DEBUG] bot ethers v6:`, ethers6.version || 'unknown');
            console.log(`[SDK DEBUG] ethers5 alias:`, ethers5.version || 'unknown');
            
            // Check if SDK has nested ethers
            try {
                const nested = require("hyperlend-isolated-sdk/node_modules/ethers");
                console.log(`[SDK DEBUG] SDK nested ethers:`, nested.version || 'unknown');
            } catch (e) {
                console.log(`[SDK DEBUG] SDK has no nested ethers, using top-level ethers`);
            }
            
            console.log(`[SDK DEBUG] providerV5.call type:`, typeof providerV5Instance.call);
            console.log(`[SDK DEBUG] Registry address: ${registryAddress}`);
            
            // Verify provider has call method (ethers v5 requirement)
            if (typeof providerV5Instance.call !== "function") {
                console.warn(`[SDK DEBUG] WARNING: providerV5.call is not a function - provider may be incompatible`);
            }
        }

        // Initialize SDK with ethers v5 provider
        const sdk = new HyperlendSDK(providerV5Instance, registryAddress);

        // Runtime assertions (only when debug enabled)
        if (process.env.SDK_DEBUG === '1') {
            console.log(`[SDK DEBUG] SDK object keys:`, Object.keys(sdk).join(', '));
            
            // Find contracts with null providers
            findNullProviderContracts(sdk, "sdk", 4);
        }

        // Hotfix: reconnect contracts to providerV5 if requested
        if (process.env.SDK_FORCE_CONNECT === '1') {
            reconnectContracts(sdk, providerV5Instance, 4);
            if (process.env.SDK_DEBUG === '1') {
                console.log(`[SDK DEBUG] Reconnected contracts, checking again...`);
                findNullProviderContracts(sdk, "sdk", 4);
            }
        }

        // Store SDK instance
        sdkInstance = {
            sdk: sdk,
            provider: providerV5Instance
        };

        // Debug logging
        if (process.env.SDK_DEBUG === '1') {
            console.log(`[SDK DEBUG] SDK initialized successfully with ethers v5 provider`);
        }

        initialized = true;
        return sdkInstance;
    } catch (error) {
        initialized = false;
        throw new Error(`SDK initialization failed: ${error.message}`);
    }
}

/**
 * Read pair data from SDK
 * @param {string} pairAddress - Isolated pair address
 * @returns {Promise<Object>} Pair data
 */
async function sdkReadPairData(pairAddress) {
    try {
        const { sdk } = await initializeSdk();
        return await sdk.readPairData(pairAddress);
    } catch (error) {
        throw new Error(`Failed to read pair data for ${pairAddress}: ${error.message}`);
    }
}

/**
 * Read user position from SDK
 * @param {string} pairAddress - Isolated pair address
 * @param {string} userAddress - User address
 * @returns {Promise<Object>} User position data
 */
async function sdkReadUserPosition(pairAddress, userAddress) {
    try {
        const { sdk } = await initializeSdk();
        return await sdk.readUserPosition(pairAddress, userAddress);
    } catch (error) {
        throw new Error(`Failed to read user position for ${userAddress} at pair ${pairAddress}: ${error.message}`);
    }
}

/**
 * Get account state for a borrower (normalized format)
 * @param {string} pairAddress - Isolated pair address
 * @param {string} borrower - Borrower address
 * @returns {Object} Normalized account state
 */
async function sdkGetAccountState(pairAddress, borrower) {
    try {
        const position = await sdkReadUserPosition(pairAddress, borrower);
        
        // SDK returns ethers v5 BigNumber - convert to BigInt for consistency with bot
        const normalized = {
            borrower,
            borrowShares: BigInt(position.userBorrowShares.toString()),
            borrowAmount: null, // SDK doesn't provide this directly, would need conversion
            collateralAmount: BigInt(position.userCollateralBalance.toString()),
            maxBorrowAllowed: null,
            isLiquidatable: null,
            healthFactor: null,
            liquidationPrice: position.liquidationPrice ? BigInt(position.liquidationPrice.toString()) : null,
            details: {
                formattedCollateralBalance: position.formattedCollateralBalance,
                formattedBorrowShares: position.formattedBorrowShares,
                formattedLiquidationPrice: position.formattedLiquidationPrice,
                collateralSymbol: position.collateralSymbol,
                assetSymbol: position.assetSymbol
            }
        };

        // Infer isLiquidatable: if borrowShares === 0, definitely not liquidatable
        if (normalized.borrowShares === 0n) {
            normalized.isLiquidatable = false;
        } else {
            // If borrowShares > 0, we can't determine liquidatability without price comparison
            // Return null to indicate "unknown" - caller can proceed to simulation
            normalized.isLiquidatable = null;
        }

        // Debug logging if enabled
        if (process.env.SDK_DEBUG === '1') {
            console.log(`[SDK DEBUG] Account state for ${borrower}:`, JSON.stringify(normalized, (key, value) => 
                typeof value === 'bigint' ? value.toString() : value, 2));
        }

        return normalized;
    } catch (error) {
        throw new Error(`SDK error for borrower ${borrower} at pair ${pairAddress}: ${error.message}`);
    }
}

/**
 * Check if a borrower is liquidatable
 * @param {string} pairAddress - Isolated pair address
 * @param {string} borrower - Borrower address
 * @returns {boolean|null} true if liquidatable, false if not, null on error or unknown
 */
async function sdkIsLiquidatable(pairAddress, borrower) {
    try {
        const accountState = await sdkGetAccountState(pairAddress, borrower);
        
        // If borrowShares === 0, definitely not liquidatable
        if (accountState.isLiquidatable === false) {
            return false;
        }
        
        // If borrowShares > 0 but we can't determine liquidatability without price data,
        // return null (unknown) - caller should proceed to simulation
        return null;
    } catch (error) {
        // Return null on error (caller should treat as unknown)
        console.error(`[SDK] sdkIsLiquidatable failed for ${borrower}:`, error.message);
        if (process.env.SDK_DEBUG === '1') {
            console.error(`[SDK DEBUG] Full error:`, error.stack);
        }
        return null;
    }
}

/**
 * Get user liquidation price from SDK
 * @param {string} pairAddress - Isolated pair address
 * @param {string} borrower - Borrower address
 * @returns {Promise<Object>} Liquidation price and raw values
 */
async function sdkGetUserLiquidationPrice(pairAddress, borrower) {
    try {
        const position = await sdkReadUserPosition(pairAddress, borrower);
        
        // Extract liquidation price - SDK returns formattedLiquidationPrice as string
        // Also get raw values for logging
        const liquidationPriceStr = position.formattedLiquidationPrice || '0';
        const liquidationPrice = parseFloat(liquidationPriceStr);
        
        return {
            liquidationPrice: liquidationPrice,
            liquidationPriceRaw: position.liquidationPrice ? position.liquidationPrice.toString() : '0',
            borrowSharesRaw: position.userBorrowShares ? position.userBorrowShares.toString() : '0',
            collateralRaw: position.userCollateralBalance ? position.userCollateralBalance.toString() : '0',
            borrowSharesFormatted: position.formattedBorrowShares,
            collateralFormatted: position.formattedCollateralBalance
        };
    } catch (error) {
        throw new Error(`Failed to get liquidation price for ${borrower} at pair ${pairAddress}: ${error.message}`);
    }
}

module.exports = {
    sdkGetAccountState,
    sdkIsLiquidatable,
    sdkReadPairData,
    sdkReadUserPosition,
    sdkGetUserLiquidationPrice,
    PAIR_ADDRESS
};
