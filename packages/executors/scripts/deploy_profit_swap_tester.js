/**
 * Deploy ProfitSwapTester contract to HyperEVM
 * 
 * Usage:
 *   pnpm --filter @packages/executors hardhat run scripts/deploy_profit_swap_tester.js --network hyperEvm
 */

const hre = require("hardhat");

const WHYPE_ADDRESS = "0x5555555555555555555555555555555555555555";

async function main() {
  console.log("\n========================================");
  console.log("  ProfitSwapTester Deployment");
  console.log("========================================\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Network:", hre.network.name);
  console.log("WHYPE:", WHYPE_ADDRESS);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "HYPE");

  // Deploy
  console.log("\nDeploying ProfitSwapTester...");
  const Tester = await hre.ethers.getContractFactory("ProfitSwapTester");
  const tester = await Tester.deploy(deployer.address, WHYPE_ADDRESS);
  await tester.waitForDeployment();

  const testerAddress = await tester.getAddress();
  console.log("✓ ProfitSwapTester deployed to:", testerAddress);

  console.log("\n========================================");
  console.log("  Deployment Complete!");
  console.log("========================================");
  console.log("\nTo test profit swap, run:");
  console.log(`  node scripts/test_profit_swap.js ${testerAddress}`);
  console.log("\n========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
