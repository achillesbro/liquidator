const { ethers } = require("ethers");

const MULTICALL3_ABI = [
    "function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) external payable returns (tuple(bool success,bytes returnData)[] returnData)"
];

/**
 * Execute batched contract calls using Multicall3
 * @param {ethers.Provider} provider - Ethers provider
 * @param {Array<{target: string, callData: string, allowFailure?: boolean}>} calls - Array of calls to batch
 * @returns {Promise<Array<{success: boolean, returnData: string}>>} Array of results
 */
async function multicall(provider, calls) {
    const multicallAddress = process.env.MULTICALL3_ADDRESS;
    if (!multicallAddress) {
        throw new Error("MULTICALL3_ADDRESS environment variable is required");
    }

    const multicall3 = new ethers.Contract(multicallAddress, MULTICALL3_ABI, provider);

    const formattedCalls = calls.map(({ target, callData, allowFailure = true }) => ({
        target,
        allowFailure: allowFailure !== undefined ? allowFailure : true,
        callData
    }));

    const returnData = await multicall3.aggregate3.staticCall(formattedCalls);

    return returnData.map(({ success, returnData }) => ({
        success,
        returnData
    }));
}

module.exports = { multicall };
