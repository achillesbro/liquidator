/**
 * Test the profit swap flow: loanToken → WHYPE → HYPE
 * 
 * Usage:
 *   TESTER_ADDRESS=0x... pnpm hardhat run scripts/test_profit_swap.js --network hyperEvm
 * 
 * Prerequisites:
 *   - Deploy ProfitSwapTester contract first
 *   - Have some USDHL (or other loan token) in your wallet
 *   - Set PRIVATE_KEY_MAINNET in environment
 */

const { ethers } = require("hardhat");

// Get tester address from env
const TESTER_ADDRESS = process.env.TESTER_ADDRESS;

// Contract addresses
const WHYPE_ADDRESS = "0x5555555555555555555555555555555555555555";
const PRJX_ROUTER = "0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B";

// Test tokens
const TOKENS = {
  USDHL: { address: "0xb50A96253aBDF803D85efcDce07Ad8becBc52BD5", decimals: 6, feeTier: 3000 },
  USDT0: { address: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb", decimals: 6, feeTier: 500 },
};

// ABIs
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const TESTER_ABI = [
  "function testProfitSwap(address loanToken, uint256 amount, address router, uint24 feeTier, address recipient) external returns (uint256 whypeReceived, uint256 hypeReceived)",
  "function rescueToken(address token, address to, uint256 amount) external",
  "function rescueETH(address to, uint256 amount) external",
];

async function main() {
  const testerAddress = TESTER_ADDRESS;
  if (!testerAddress) {
    console.error("Usage: TESTER_ADDRESS=0x... pnpm hardhat run scripts/test_profit_swap.js --network hyperEvm");
    process.exit(1);
  }

  console.log("\n========================================");
  console.log("  Profit Swap Test");
  console.log("========================================\n");

  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);
  console.log("Tester contract:", testerAddress);

  // Connect to tester contract
  const tester = new ethers.Contract(testerAddress, TESTER_ABI, signer);

  // Check signer HYPE balance before
  const hypeBefore = await ethers.provider.getBalance(signer.address);
  console.log("HYPE balance before:", ethers.formatEther(hypeBefore));

  // Test with USDHL
  const token = TOKENS.USDHL;
  const tokenContract = new ethers.Contract(token.address, ERC20_ABI, signer);
  
  // Check token balance
  const tokenBalance = await tokenContract.balanceOf(signer.address);
  const symbol = await tokenContract.symbol();
  console.log(`\n${symbol} balance:`, ethers.formatUnits(tokenBalance, token.decimals));

  if (tokenBalance === 0n) {
    console.log(`\n❌ No ${symbol} balance. Please get some ${symbol} first.`);
    console.log(`   ${symbol} address: ${token.address}`);
    process.exit(1);
  }

  // Use a small test amount (1 token or 10% of balance, whichever is smaller)
  const testAmount = tokenBalance < ethers.parseUnits("1", token.decimals)
    ? tokenBalance
    : ethers.parseUnits("1", token.decimals);
  
  console.log(`\nTest amount: ${ethers.formatUnits(testAmount, token.decimals)} ${symbol}`);
  console.log(`Fee tier: ${token.feeTier} (${token.feeTier / 10000}%)`);

  // Approve tester to spend tokens
  console.log("\n1. Approving tester to spend tokens...");
  const approveTx = await tokenContract.approve(testerAddress, testAmount);
  await approveTx.wait();
  console.log("   ✓ Approved");

  // Execute profit swap test
  console.log("\n2. Executing profit swap test...");
  console.log(`   ${symbol} → WHYPE → HYPE`);
  
  try {
    const tx = await tester.testProfitSwap(
      token.address,
      testAmount,
      PRJX_ROUTER,
      token.feeTier,
      signer.address // Send HYPE back to signer
    );
    
    console.log("   TX hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("   ✓ TX confirmed in block", receipt.blockNumber);

    // Parse events
    const iface = new ethers.Interface([
      "event ProfitSwapTested(address indexed loanToken, uint256 amountIn, uint256 whypeReceived, uint256 hypeReceived)",
      "event HypeSent(address indexed to, uint256 amount)",
    ]);

    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed.name === "ProfitSwapTested") {
          console.log("\n   Results:");
          console.log(`   - Input: ${ethers.formatUnits(parsed.args.amountIn, token.decimals)} ${symbol}`);
          console.log(`   - WHYPE received: ${ethers.formatEther(parsed.args.whypeReceived)} WHYPE`);
          console.log(`   - HYPE received: ${ethers.formatEther(parsed.args.hypeReceived)} HYPE`);
        }
      } catch (e) {
        // Not our event
      }
    }

    // Check HYPE balance after
    const hypeAfter = await ethers.provider.getBalance(signer.address);
    const hypeGained = hypeAfter - hypeBefore;
    
    // Account for gas spent
    const gasUsed = receipt.gasUsed;
    const gasPrice = receipt.gasPrice || tx.gasPrice;
    const gasCost = gasUsed * gasPrice;
    
    console.log("\n   Summary:");
    console.log(`   - Gas used: ${gasUsed.toString()} (${ethers.formatEther(gasCost)} HYPE)`);
    console.log(`   - Net HYPE change: ${ethers.formatEther(hypeGained)} HYPE`);
    console.log(`   - HYPE profit (excl gas): ${ethers.formatEther(hypeGained + gasCost)} HYPE`);

    console.log("\n========================================");
    console.log("  ✓ Profit Swap Test PASSED!");
    console.log("========================================\n");

  } catch (error) {
    console.log("\n   ❌ Transaction failed:", error.message);
    
    // Try to decode revert reason
    if (error.data) {
      console.log("   Revert data:", error.data);
    }
    
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
