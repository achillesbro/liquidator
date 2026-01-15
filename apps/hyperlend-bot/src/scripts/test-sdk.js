require("dotenv").config();

const PAIR_ADDRESS = '0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd';
const TEST_USER = process.env.SDK_SAMPLE_BORROWER || '0x00845073402E19E26F68f4Fc868DF4f8eC2deECd';

const { sdkReadPairData, sdkReadUserPosition } = require("../utils/hyperlendIsolatedSdk");

async function test() {
    try {
        console.log("Testing SDK with ethers v5 provider...");
        console.log(`Pair Address: ${PAIR_ADDRESS}`);
        console.log(`Test User: ${TEST_USER}`);
        console.log(`Registry Address: ${process.env.REGISTRY_ADDRESS || 'NOT SET (using dummy)'}`);
        console.log("");

        // Test 1: readPairData
        console.log("Test 1: readPairData()");
        try {
            const pairData = await sdkReadPairData(PAIR_ADDRESS);
            console.log("✓ readPairData() succeeded");
            console.log(`  Asset: ${pairData.assetSymbol} (${pairData.asset})`);
            console.log(`  Collateral: ${pairData.collateralSymbol} (${pairData.collateral})`);
            console.log(`  Total Assets: ${pairData.formattedTotalAssetAmount} ${pairData.assetSymbol}`);
            console.log(`  Total Borrows: ${pairData.formattedTotalBorrowAmount} ${pairData.assetSymbol}`);
            console.log(`  Max LTV: ${pairData.maxLTV.toString()}`);
        } catch (error) {
            console.error("✗ readPairData() failed:", error.message);
            throw error;
        }
        console.log("");

        // Test 2: readUserPosition
        console.log("Test 2: readUserPosition()");
        try {
            const userPosition = await sdkReadUserPosition(PAIR_ADDRESS, TEST_USER);
            console.log("✓ readUserPosition() succeeded");
            console.log(`  Collateral Balance: ${userPosition.formattedCollateralBalance} ${userPosition.collateralSymbol}`);
            console.log(`  Borrow Shares: ${userPosition.formattedBorrowShares} ${userPosition.assetSymbol}`);
            console.log(`  Liquidation Price: ${userPosition.formattedLiquidationPrice}`);
            console.log(`  User Collateral Balance (raw): ${userPosition.userCollateralBalance.toString()}`);
            console.log(`  User Borrow Shares (raw): ${userPosition.userBorrowShares.toString()}`);
        } catch (error) {
            console.error("✗ readUserPosition() failed:", error.message);
            throw error;
        }
        console.log("");

        console.log("✓ All tests passed!");

    } catch (error) {
        console.error("Error:", error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

test();
