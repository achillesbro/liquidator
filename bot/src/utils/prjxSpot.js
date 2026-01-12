const { ethers } = require("ethers");

// Known ProjectX pool address for xHYPE/USDC
const PRJX_POOL_ADDRESS = '0x6a76bd79bd97ffe55eb87c701f9ae8a1e3d7254e';

const POOL_ABI = [
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function token0() view returns (address)",
    "function token1() view returns (address)"
];

/**
 * Get spot price from UniV3-style pool using slot0()
 * @param {string} poolAddress - Pool contract address
 * @param {string} token0Address - First token address (for ordering)
 * @param {string} token1Address - Second token address (for ordering)
 * @returns {Promise<Object>} Spot price and pool data
 */
async function getSpotPriceFromPool(poolAddress, token0Address, token1Address) {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.RPC);
    const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
    
    try {
        // Read token0 and token1 to confirm ordering
        const [token0, token1] = await Promise.all([
            pool.token0(),
            pool.token1()
        ]);
        
        // Read slot0 to get sqrtPriceX96
        const slot0 = await pool.slot0();
        const sqrtPriceX96 = slot0.sqrtPriceX96;
        
        // Determine token ordering
        const token0Matches = token0.toLowerCase() === token0Address.toLowerCase();
        const token1Matches = token1.toLowerCase() === token1Address.toLowerCase();
        const isReversed = token0.toLowerCase() === token1Address.toLowerCase() && token1.toLowerCase() === token0Address.toLowerCase();
        
        if (!token0Matches && !token1Matches && !isReversed) {
            throw new Error(`Pool tokens do not match expected addresses. Pool has ${token0} and ${token1}, expected ${token0Address} and ${token1Address}`);
        }
        
        // Convert sqrtPriceX96 to number for calculation
        // sqrtPriceX96 is uint160, max value ~1.46e48
        const Q96 = 2 ** 96;
        const sqrtPriceNum = Number(sqrtPriceX96);
        
        // Price from slot0: price = (sqrtPriceX96 / 2^96)^2
        // This gives token1 per token0 in raw units (wei)
        const sqrtPriceRatio = sqrtPriceNum / Q96;
        const priceRaw = sqrtPriceRatio * sqrtPriceRatio;
        
        // Decimals: xHYPE = 18, USDC = 6
        const decimalsXHYPE = 18;
        const decimalsUSDC = 6;
        
        let spotPrice;
        if (token0Matches && token1Matches) {
            // Normal order: token0 = xHYPE (18), token1 = USDC (6)
            // priceRaw is USDC_wei / xHYPE_wei
            // Convert to human: multiply by 10^(18-6) = 10^12
            spotPrice = priceRaw * (10 ** (decimalsXHYPE - decimalsUSDC));
        } else if (isReversed) {
            // Reversed: token0 = USDC (6), token1 = xHYPE (18)
            // priceRaw is xHYPE_wei / USDC_wei
            // We want USDC per xHYPE, so invert: 1/priceRaw gives USDC_wei / xHYPE_wei
            // Convert to human: multiply by 10^(18-6) = 10^12
            spotPrice = (1.0 / priceRaw) * (10 ** (decimalsXHYPE - decimalsUSDC));
        } else {
            throw new Error("Unexpected token ordering");
        }
        
        return {
            spotPrice: spotPrice,
            sqrtPriceX96: sqrtPriceX96,
            token0: token0,
            token1: token1
        };
    } catch (error) {
        throw new Error(`Failed to get spot price from pool: ${error.message}`);
    }
}

module.exports = {
    getSpotPriceFromPool,
    PRJX_POOL_ADDRESS
};
