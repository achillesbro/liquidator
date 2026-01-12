// Utility for decoding revert reasons from transaction errors
const { ethers } = require("ethers");

// Standard error selectors
const ERROR_SELECTORS = {
    "0x08c379a0": "Error(string)",
    "0x4e487b71": "Panic(uint256)",
};

/**
 * Extract error selector (first 4 bytes) from hex data
 */
function selector(hexData) {
    if (!hexData || hexData === "0x") return null;
    const data = typeof hexData === "string" ? hexData : hexData.data || hexData.reason?.data || "";
    if (!data.startsWith("0x") || data.length < 10) return null;
    return data.slice(0, 10);
}

/**
 * Decode revert data using provided ABIs
 * @param {string} revertData - Hex string of revert data
 * @param {Array} abis - Array of ABI arrays to try parsing with
 * @returns {Object|null} - { name, args, selector } or null if not decodable
 */
function decodeRevert(revertData, abis = []) {
    if (!revertData || revertData === "0x") return null;
    
    const errSelector = selector(revertData);
    if (!errSelector) return null;
    
    // Check standard errors first
    if (ERROR_SELECTORS[errSelector]) {
        try {
            // Error(string) - decode the string
            if (errSelector === "0x08c379a0") {
                const iface = new ethers.Interface(["error Error(string)"]);
                const decoded = iface.parseError(revertData);
                if (decoded) {
                    return {
                        name: "Error",
                        args: decoded.args,
                        selector: errSelector,
                        message: decoded.args[0]
                    };
                }
            }
            // Panic(uint256) - decode the code
            if (errSelector === "0x4e487b71") {
                const iface = new ethers.Interface(["error Panic(uint256)"]);
                const decoded = iface.parseError(revertData);
                if (decoded) {
                    const panicCode = decoded.args[0];
                    const panicMessages = {
                        0x00: "Generic compiler inserted panics",
                        0x01: "Assertion failed",
                        0x11: "Arithmetic underflow/overflow",
                        0x12: "Division/modulo by zero",
                        0x21: "Conversion to enum out of bounds",
                        0x22: "Storage byte array incorrectly encoded",
                        0x31: "Pop on empty array",
                        0x32: "Array index out of bounds",
                        0x41: "Too much memory allocated",
                        0x51: "Zero-initialized variable of internal function type"
                    };
                    return {
                        name: "Panic",
                        args: decoded.args,
                        selector: errSelector,
                        code: panicCode,
                        message: panicMessages[panicCode] || `Unknown panic code: ${panicCode}`
                    };
                }
            }
        } catch (e) {
            // Fall through to custom error parsing
        }
    }
    
    // Try to decode as custom error using provided ABIs
    for (const abi of abis) {
        try {
            const iface = new ethers.Interface(abi);
            const decoded = iface.parseError(revertData);
            if (decoded) {
                return {
                    name: decoded.name,
                    args: decoded.args,
                    selector: errSelector,
                    signature: decoded.signature
                };
            }
        } catch (e) {
            // Try next ABI
            continue;
        }
    }
    
    // Return selector only if we couldn't decode
    return {
        name: null,
        args: null,
        selector: errSelector,
        signature: null
    };
}

/**
 * Format revert information for logging
 */
function formatRevert(decoded) {
    if (!decoded) return "Unknown revert (empty data)";
    
    if (decoded.message) {
        return `${decoded.name || "Error"}: ${decoded.message}`;
    }
    
    if (decoded.name) {
        const argsStr = decoded.args 
            ? `(${decoded.args.map(a => typeof a === 'bigint' ? a.toString() : String(a)).join(", ")})`
            : "()";
        return `${decoded.name}${argsStr} [selector: ${decoded.selector}]`;
    }
    
    return `Unknown error [selector: ${decoded.selector}]`;
}

module.exports = {
    selector,
    decodeRevert,
    formatRevert,
    ERROR_SELECTORS
};