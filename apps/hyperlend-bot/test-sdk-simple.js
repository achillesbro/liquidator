require("dotenv").config();
const { ethers } = require("ethers");

const PAIR_ADDRESS = '0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd';
const TEST_USER = '0x00845073402E19E26F68f4Fc868DF4f8eC2deECd'; // From candidates.json

async function test() {
    try {
        console.log("Testing SDK with minimal usage...");
        console.log(`Pair Address: ${PAIR_ADDRESS}`);
        console.log(`Test User: ${TEST_USER}`);
        console.log(`Registry Address: ${process.env.REGISTRY_ADDRESS || 'NOT SET'}`);
        console.log("");

        // Import SDK
        const sdkModule = await import("hyperlend-isolated-sdk");
        const HyperlendSDK = sdkModule.HyperlendSDK || sdkModule.default?.HyperlendSDK || sdkModule.default;
        
        if (!HyperlendSDK) {
            throw new Error("Could not find HyperlendSDK");
        }

        // Create provider
        const rpcUrl = process.env.RPC_URL || process.env.RPC;
        if (!rpcUrl) {
            throw new Error("RPC_URL or RPC environment variable is required");
        }
        const provider = new ethers.JsonRpcProvider(rpcUrl);

        // Initialize SDK - using a dummy registry address if not set
        const registryAddress = process.env.REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000';
        console.log(`Initializing SDK with registry: ${registryAddress}`);
        const sdk = new HyperlendSDK(provider, registryAddress);
        console.log("✓ SDK initialized\n");

        // Test 1: readPairData
        console.log("Test 1: readPairData()");
        try {
            const pairData = await sdk.readPairData(PAIR_ADDRESS);
            console.log("✓ readPairData() succeeded");
            console.log(`  Asset: ${pairData.assetSymbol}`);
            console.log(`  Collateral: ${pairData.collateralSymbol}`);
            console.log(`  Total Assets: ${pairData.formattedTotalAssetAmount}`);
            console.log(`  Total Borrows: ${pairData.formattedTotalBorrowAmount}`);
        } catch (error) {
            console.error("✗ readPairData() failed:", error.message);
        }
        console.log("");

        // Test 2: readUserPosition
        console.log("Test 2: readUserPosition()");
        try {
            const userPosition = await sdk.readUserPosition(PAIR_ADDRESS, TEST_USER);
            console.log("✓ readUserPosition() succeeded");
            console.log(`  Collateral Balance: ${userPosition.formattedCollateralBalance}`);
            console.log(`  Borrow Shares: ${userPosition.formattedBorrowShares}`);
            console.log(`  Liquidation Price: ${userPosition.formattedLiquidationPrice}`);
        } catch (error) {
            console.error("✗ readUserPosition() failed:", error.message);
        }
        console.log("");

    } catch (error) {
        console.error("Error:", error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

test();
