const fs = require("fs");
const { ethers } = require("ethers");

/**
 * Parse a CSV line handling quoted fields
 * @param {string} line - CSV line to parse
 * @returns {Array<string>} Array of field values
 */
function parseCsvLine(line) {
    const fields = [];
    let currentField = "";
    let insideQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                // Escaped quote (double quote)
                currentField += '"';
                i++; // Skip next quote
            } else {
                // Toggle quote state
                insideQuotes = !insideQuotes;
            }
        } else if (char === ',' && !insideQuotes) {
            // Field separator (only outside quotes)
            fields.push(currentField);
            currentField = "";
        } else {
            currentField += char;
        }
    }
    
    // Push last field
    fields.push(currentField);
    
    return fields;
}

/**
 * Read CSV file and return array of row objects
 * @param {string} filePath - Path to CSV file
 * @returns {Array<Object>} Array of row objects keyed by header names
 */
function readTxCsv(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
    
    if (lines.length === 0) {
        return [];
    }
    
    // Parse header
    const headers = parseCsvLine(lines[0]);
    
    // Parse data rows
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const fields = parseCsvLine(lines[i]);
        if (fields.length === headers.length) {
            const row = {};
            for (let j = 0; j < headers.length; j++) {
                row[headers[j]] = fields[j];
            }
            rows.push(row);
        }
    }
    
    return rows;
}

/**
 * Extract candidate addresses from CSV export
 * @param {string} filePath - Path to CSV file
 * @returns {Array<string>} Array of checksummed candidate addresses
 */
function extractCandidatesFromCsv(filePath) {
    const rows = readTxCsv(filePath);
    const candidates = new Set();
    
    // Normalized method names to match
    const targetMethods = [
        "borrow asset",
        "leveraged position",
        "repay asset",
        "repay asset with collateral"
    ];
    
    for (const row of rows) {
        // Normalize Method column
        const method = (row["Method"] || "").toLowerCase().trim();
        
        // Check if method matches
        if (targetMethods.includes(method)) {
            const fromAddress = row["From"];
            
            if (fromAddress && ethers.isAddress(fromAddress)) {
                // Checksum the address
                const checksummed = ethers.getAddress(fromAddress);
                candidates.add(checksummed);
            }
        }
    }
    
    return Array.from(candidates).sort();
}

module.exports = {
    extractCandidatesFromCsv
};
