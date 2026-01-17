/**
 * Deploy Morpho Flashloan Executor V2 (MorphoFlashloanExecutorV2) to HyperEVM
 * 
 * V2 features:
 * - Converts all profits to native HYPE for gas-aware profitability
 * - Swaps loanToken profit -> WHYPE via Project X
 * - Unwraps WHYPE -> HYPE before sending to treasury
 * 
 * Usage:
 *   pnpm --filter @packages/executors hardhat run scripts/deploy_morpho_flashloan_executor_v2.js --network hyperEvm
 * 
 * Required env:
 *   PRIVATE_KEY_MAINNET - Deployer private key (will also be owner)
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// HyperEVM contract addresses
const MORPHO_BLUE_ADDRESS = "0x68e37dE8d93d3496ae143F2E900490f6280C57cD";
const WHYPE_ADDRESS = "0x5555555555555555555555555555555555555555";

async function main() {
  console.log("\n========================================");
  console.log("  Morpho Flashloan Executor V2 Deployment");
  console.log("========================================\n");

  // Get deployer
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", (await hre.ethers.provider.getNetwork()).chainId);
  console.log("Morpho Blue:", MORPHO_BLUE_ADDRESS);
  console.log("WHYPE:", WHYPE_ADDRESS);

  // Check balance
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "HYPE");

  if (balance < hre.ethers.parseEther("0.01")) {
    console.error("\n❌ Insufficient balance for deployment. Need at least 0.01 HYPE.");
    process.exit(1);
  }

  // Deploy MorphoFlashloanExecutorV2
  console.log("\nDeploying MorphoFlashloanExecutorV2...");
  const Executor = await hre.ethers.getContractFactory("MorphoFlashloanExecutorV2");
  const executor = await Executor.deploy(deployer.address, MORPHO_BLUE_ADDRESS, WHYPE_ADDRESS);
  await executor.waitForDeployment();

  const executorAddress = await executor.getAddress();
  console.log("✓ MorphoFlashloanExecutorV2 deployed to:", executorAddress);

  // Verify configuration
  const owner = await executor.owner();
  const morpho = await executor.morpho();
  const whype = await executor.whype();
  console.log("✓ Owner set to:", owner);
  console.log("✓ Morpho set to:", morpho);
  console.log("✓ WHYPE set to:", whype);

  // Write deployment info to JSON
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Read existing deployment info
  const deploymentPath = path.join(deploymentsDir, "hyperEvm.json");
  let existingDeployment = {};
  if (fs.existsSync(deploymentPath)) {
    existingDeployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  }

  // Update with V2 flashloan executor
  const deploymentInfo = {
    ...existingDeployment,
    network: hre.network.name,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    morphoFlashloanExecutorV2: executorAddress,
    morphoBlue: MORPHO_BLUE_ADDRESS,
    whype: WHYPE_ADDRESS,
    flashloanExecutorV2Owner: owner,
    flashloanExecutorV2Deployer: deployer.address,
    flashloanExecutorV2DeployedAt: new Date().toISOString(),
    flashloanExecutorV2TxHash: executor.deploymentTransaction()?.hash,
  };

  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("✓ Deployment info written to:", deploymentPath);

  console.log("\n========================================");
  console.log("  Deployment Complete!");
  console.log("========================================");
  console.log("\nTo enable V2 executor, add to .env:");
  console.log(`  FLASHLOAN_EXECUTOR_V2_ADDRESS_999=${executorAddress}`);
  console.log(`  USE_EXECUTOR_V2=1`);
  console.log("\nEnsure you also have:");
  console.log("  EXECUTION_MODE=flashloan");
  console.log("  EXECUTION_ENABLED=1");
  console.log("\nOptional Project X config (defaults are set):");
  console.log("  PRJX_ROUTER_ADDRESS=0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B");
  console.log("  PRJX_QUOTER_ADDRESS=0x239F11a7A3E08f2B8110D4CA9F6B95d4c8865258");
  console.log("  PROFIT_SLIPPAGE_BPS=100  # 1% slippage for profit swap");
  console.log("\n========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
