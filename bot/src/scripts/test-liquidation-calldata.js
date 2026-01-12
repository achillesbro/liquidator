require("dotenv").config();
const { ethers } = require("ethers");
const CONTRACT_ABI_JSON = require("../../../contracts/artifacts/contracts/IsolatedLiquidator.sol/IsolatedLiquidator.json");

// Load contract ABI
const CONTRACT_ABI = CONTRACT_ABI_JSON.abi;

// Configuration from environment
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
if (!CONTRACT_ADDRESS) {
    console.error("Error: CONTRACT_ADDRESS environment variable is required");
    process.exit(1);
}

// Default test parameters
const borrower = process.env.TEST_BORROWER || "0x00845073402E19E26F68f4Fc868DF4f8eC2deECd";
const sharesToLiquidate = process.env.TEST_SHARES ? BigInt(process.env.TEST_SHARES) : 1n;
const minUsdcOut = process.env.TEST_MIN_USDC_OUT ? BigInt(process.env.TEST_MIN_USDC_OUT) : 0n;
const deadline = process.env.TEST_DEADLINE ? BigInt(process.env.TEST_DEADLINE) : BigInt(Math.floor(Date.now() / 1000) + 60);

async function main() {
    console.log("=== Liquidation Calldata Encoding Test ===\n");
    
    console.log("Configuration:");
    console.log(`  Contract: ${CONTRACT_ADDRESS}`);
    console.log(`  Borrower: ${borrower}`);
    console.log(`  Shares: ${sharesToLiquidate.toString()}`);
    console.log(`  Min USDC Out: ${minUsdcOut.toString()}`);
    console.log(`  Deadline: ${deadline.toString()} (${new Date(Number(deadline) * 1000).toISOString()})`);
    console.log("");
    
    // Build Interface
    const iface = new ethers.Interface(CONTRACT_ABI);
    
    // Get function fragment
    const runFragment = iface.getFunction("run");
    if (!runFragment) {
        throw new Error("run function not found in ABI");
    }
    
    // Encode function call
    console.log("Encoding function call...");
    const calldata = iface.encodeFunctionData("run", [
        borrower,
        sharesToLiquidate,
        minUsdcOut,
        deadline
    ]);
    
    // Extract function selector (first 4 bytes)
    const selector = calldata.slice(0, 10); // 0x + 4 bytes
    
    console.log(`  Function selector: ${selector}`);
    console.log(`  Full calldata: ${calldata}`);
    console.log(`  Calldata length: ${calldata.length} characters (${(calldata.length - 2) / 2} bytes)`);
    console.log("");
    
    // Decode back to verify roundtrip
    console.log("Decoding calldata (roundtrip verification)...");
    try {
        const decoded = iface.decodeFunctionData("run", calldata);
        console.log(`  Decoded borrower: ${decoded[0]}`);
        console.log(`  Decoded shares: ${decoded[1].toString()}`);
        console.log(`  Decoded minUsdcOut: ${decoded[2].toString()}`);
        console.log(`  Decoded deadline: ${decoded[3].toString()}`);
        console.log("");
        
        // Verify values match
        const borrowerMatch = ethers.getAddress(decoded[0]) === ethers.getAddress(borrower);
        const sharesMatch = decoded[1] === sharesToLiquidate;
        const minOutMatch = decoded[2] === minUsdcOut;
        const deadlineMatch = decoded[3] === deadline;
        
        if (borrowerMatch && sharesMatch && minOutMatch && deadlineMatch) {
            console.log("✓ Encoding/decoding roundtrip successful - all values match");
        } else {
            console.error("✗ Encoding/decoding roundtrip failed:");
            if (!borrowerMatch) console.error(`  Borrower mismatch: expected ${borrower}, got ${decoded[0]}`);
            if (!sharesMatch) console.error(`  Shares mismatch: expected ${sharesToLiquidate.toString()}, got ${decoded[1].toString()}`);
            if (!minOutMatch) console.error(`  MinUsdcOut mismatch: expected ${minUsdcOut.toString()}, got ${decoded[2].toString()}`);
            if (!deadlineMatch) console.error(`  Deadline mismatch: expected ${deadline.toString()}, got ${decoded[3].toString()}`);
            process.exit(1);
        }
    } catch (error) {
        console.error(`✗ Decoding failed: ${error.message}`);
        process.exit(1);
    }
    
    console.log("\n=== Test Passed ===");
}

main().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
});