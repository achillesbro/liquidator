require("dotenv").config();
const { ethers } = require("ethers");

const MULTICALL3_ABI = [
    "function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) external payable returns (tuple(bool success,bytes returnData)[])"
];

async function main() {
    console.log("=== Multicall3 Sanity Test ===\n");

    // Read MULTICALL3_ADDRESS from environment
    const multicallAddress = process.env.MULTICALL3_ADDRESS;
    if (!multicallAddress) {
        console.error("Error: MULTICALL3_ADDRESS environment variable is required");
        process.exit(1);
    }

    console.log(`Multicall3 Address: ${multicallAddress}`);

    // Create ethers v6 provider
    const rpcUrl = process.env.RPC_URL || process.env.RPC;
    if (!rpcUrl) {
        console.error("Error: RPC_URL or RPC environment variable is required");
        process.exit(1);
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    console.log(`RPC URL: ${rpcUrl}\n`);

    try {
        // Instantiate Multicall3 contract
        const multicall3 = new ethers.Contract(multicallAddress, MULTICALL3_ABI, provider);

        // Call aggregate3 with empty array
        console.log("Calling aggregate3([])...");
        const res = await multicall3.aggregate3.staticCall([]);

        // Verify result
        if (!Array.isArray(res)) {
            console.error(`Error: Expected array, got ${typeof res}`);
            process.exit(1);
        }

        const length = res.length;
        if (length !== 0) {
            console.error(`Error: Expected empty array, got length ${length}`);
            process.exit(1);
        }

        // Success
        console.log("Multicall3 empty aggregate success");
        console.log(`Array length: ${length}`);
        console.log("\n✓ Multicall3 is functional");
        process.exit(0);

    } catch (error) {
        console.error(`\nError: Multicall3 test failed`);
        console.error(`Message: ${error.message}`);
        if (error.reason) {
            console.error(`Reason: ${error.reason}`);
        }
        process.exit(1);
    }
}

main();
