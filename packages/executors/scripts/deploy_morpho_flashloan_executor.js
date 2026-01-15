/**
 * Deploy Morpho Flashloan Executor (MorphoFlashloanExecutor606BaXt) to HyperEVM
 * 
 * Usage:
 *   pnpm --filter @packages/executors hardhat run scripts/deploy_morpho_flashloan_executor.js --network hyperEvm
 * 
 * Required env:
 *   PRIVATE_KEY_MAINNET - Deployer private key (will also be owner)
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// HyperEVM Morpho Blue address
const MORPHO_BLUE_ADDRESS = "0x68e37dE8d93d3496ae143F2E900490f6280C57cD";

async function main() {
  console.log("\n========================================");
  console.log("  Morpho Flashloan Executor Deployment");
  console.log("========================================\n");

  // Get deployer
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", (await hre.ethers.provider.getNetwork()).chainId);
  console.log("Morpho Blue:", MORPHO_BLUE_ADDRESS);

  // Check balance
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "HYPE");

  if (balance < hre.ethers.parseEther("0.01")) {
    console.error("\n❌ Insufficient balance for deployment. Need at least 0.01 HYPE.");
    process.exit(1);
  }

  // Deploy MorphoFlashloanExecutor606BaXt
  console.log("\nDeploying MorphoFlashloanExecutor606BaXt...");
  const Executor = await hre.ethers.getContractFactory("MorphoFlashloanExecutor606BaXt");
  const executor = await Executor.deploy(deployer.address, MORPHO_BLUE_ADDRESS);
  await executor.waitForDeployment();

  const executorAddress = await executor.getAddress();
  console.log("✓ MorphoFlashloanExecutor606BaXt deployed to:", executorAddress);

  // Verify configuration
  const owner = await executor.owner();
  const morpho = await executor.morpho();
  console.log("✓ Owner set to:", owner);
  console.log("✓ Morpho set to:", morpho);

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

  // Update with flashloan executor
  const deploymentInfo = {
    ...existingDeployment,
    network: hre.network.name,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    morphoFlashloanExecutor: executorAddress,
    morphoBlue: MORPHO_BLUE_ADDRESS,
    flashloanExecutorOwner: owner,
    flashloanExecutorDeployer: deployer.address,
    flashloanExecutorDeployedAt: new Date().toISOString(),
    flashloanExecutorTxHash: executor.deploymentTransaction()?.hash,
  };

  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("✓ Deployment info written to:", deploymentPath);

  console.log("\n========================================");
  console.log("  Deployment Complete!");
  console.log("========================================");
  console.log("\nFor FLASHLOAN mode:");
  console.log(`1. Add to .env: FLASHLOAN_EXECUTOR_ADDRESS_999=${executorAddress}`);
  console.log("2. Set execution mode: EXECUTION_MODE=flashloan");
  console.log("3. Enable execution: EXECUTION_ENABLED=1");
  console.log("\nFor PREFUND mode (original):");
  console.log(`  Use existing EXECUTOR_ADDRESS_999 or set: EXECUTOR_ADDRESS_999=${executorAddress}`);
  console.log("  Set execution mode: EXECUTION_MODE=prefund (default)");
  console.log("\n========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
