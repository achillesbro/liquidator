async function main(){
    const { ethers } = require("hardhat");
    
    const Contract = await ethers.getContractFactory("IsolatedLiquidator");
    
    // Core Pool address (shared)
    const CORE_POOL_ADDRESS = process.env.CORE_POOL_ADDRESS || '0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b';
    
    // XHYPE/USDC market config
    const MARKET_XHYPE_USDC_PAIR = process.env.MARKET_XHYPE_USDC_PAIR || '0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd';
    const MARKET_XHYPE_USDC_ASSET = process.env.MARKET_XHYPE_USDC_ASSET || '0xb88339CB7199b77E23DB6E890353E22632Ba630f'; // USDC
    const MARKET_XHYPE_USDC_ROUTER = process.env.MARKET_XHYPE_USDC_ROUTER || '0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B'; // ProjectX Router
    const MARKET_XHYPE_USDC_FEE = parseInt(process.env.MARKET_XHYPE_USDC_FEE || '100'); // 0.01%
    
    // WHLP/USDT0 market config
    const MARKET_WHLP_USDT0_PAIR = process.env.MARKET_WHLP_USDT0_PAIR || '0x06Fd9D03b3d0F18E4919919b72D30c582f0a97E5';
    const MARKET_WHLP_USDT0_ASSET = process.env.MARKET_WHLP_USDT0_ASSET || '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb'; // USDT0
    const MARKET_WHLP_USDT0_ROUTER = process.env.MARKET_WHLP_USDT0_ROUTER || '0x6D99e7f6747AF2cDbB5164b6DD50e40D4fDe1e77'; // HyperSwap Router02
    const MARKET_WHLP_USDT0_POOL = process.env.MARKET_WHLP_USDT0_POOL || '0x859235541c19a3b26436fe7ecddf22142d8dccae';
    
    // Determine fee for WHLP/USDT0
    let MARKET_WHLP_USDT0_FEE = process.env.MARKET_WHLP_USDT0_FEE ? parseInt(process.env.MARKET_WHLP_USDT0_FEE) : null;
    
    // If fee not set but pool address is set, try to read from pool
    if (!MARKET_WHLP_USDT0_FEE && MARKET_WHLP_USDT0_POOL) {
        try {
            const POOL_ABI = ["function fee() view returns (uint24)"];
            const pool = await ethers.getContractAt(POOL_ABI, MARKET_WHLP_USDT0_POOL);
            MARKET_WHLP_USDT0_FEE = await pool.fee();
            console.log(`Read fee from pool ${MARKET_WHLP_USDT0_POOL}: ${MARKET_WHLP_USDT0_FEE}`);
        } catch (error) {
            console.warn(`Failed to read fee from pool ${MARKET_WHLP_USDT0_POOL}: ${error.message}`);
        }
    }
    
    // Default to 100 if still not set
    if (!MARKET_WHLP_USDT0_FEE) {
        MARKET_WHLP_USDT0_FEE = 100; // 0.01% default
        console.log(`Using default fee for WHLP/USDT0: ${MARKET_WHLP_USDT0_FEE}`);
    }
    
    console.log("\n=== Deploying IsolatedLiquidator contracts ===\n");
    
    // Deploy XHYPE/USDC liquidator
    console.log("Deploying XHYPE/USDC liquidator...");
    console.log(`  Pool: ${CORE_POOL_ADDRESS}`);
    console.log(`  Pair: ${MARKET_XHYPE_USDC_PAIR}`);
    console.log(`  Asset: ${MARKET_XHYPE_USDC_ASSET}`);
    console.log(`  Router: ${MARKET_XHYPE_USDC_ROUTER}`);
    console.log(`  Fee: ${MARKET_XHYPE_USDC_FEE}`);
    
    const contractXhypeUsdc = await Contract.deploy(
        CORE_POOL_ADDRESS,
        MARKET_XHYPE_USDC_PAIR,
        MARKET_XHYPE_USDC_ASSET,
        MARKET_XHYPE_USDC_ROUTER,
        MARKET_XHYPE_USDC_FEE
    );
    await contractXhypeUsdc.waitForDeployment();
    const addressXhypeUsdc = await contractXhypeUsdc.getAddress();
    console.log(`✓ XHYPE/USDC liquidator deployed to: ${addressXhypeUsdc}\n`);
    
    // Deploy WHLP/USDT0 liquidator
    console.log("Deploying WHLP/USDT0 liquidator...");
    console.log(`  Pool: ${CORE_POOL_ADDRESS}`);
    console.log(`  Pair: ${MARKET_WHLP_USDT0_PAIR}`);
    console.log(`  Asset: ${MARKET_WHLP_USDT0_ASSET}`);
    console.log(`  Router: ${MARKET_WHLP_USDT0_ROUTER}`);
    console.log(`  Fee: ${MARKET_WHLP_USDT0_FEE}`);
    
    const contractWhlpUsdt0 = await Contract.deploy(
        CORE_POOL_ADDRESS,
        MARKET_WHLP_USDT0_PAIR,
        MARKET_WHLP_USDT0_ASSET,
        MARKET_WHLP_USDT0_ROUTER,
        MARKET_WHLP_USDT0_FEE
    );
    await contractWhlpUsdt0.waitForDeployment();
    const addressWhlpUsdt0 = await contractWhlpUsdt0.getAddress();
    console.log(`✓ WHLP/USDT0 liquidator deployed to: ${addressWhlpUsdt0}\n`);
    
    console.log("=== Deployment Summary ===");
    console.log(`XHYPE/USDC: ${addressXhypeUsdc} (fee=${MARKET_XHYPE_USDC_FEE})`);
    console.log(`WHLP/USDT0: ${addressWhlpUsdt0} (fee=${MARKET_WHLP_USDT0_FEE})`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
