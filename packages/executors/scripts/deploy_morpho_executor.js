/**
 * Deploy Morpho Executor (Executor606BaXt) to HyperEVM
 * 
 * Usage:
 *   pnpm --filter @packages/executors hardhat run scripts/deploy_morpho_executor.js --network hyperEvm
 * 
 * Required env:
 *   PRIVATE_KEY_MAINNET - Deployer private key (will also be owner)
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("\n========================================");
  console.log("  Morpho Executor Deployment");
  console.log("========================================\n");

  // Get deployer
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", (await hre.ethers.provider.getNetwork()).chainId);

  // Check balance
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "HYPE");

  if (balance < hre.ethers.parseEther("0.01")) {
    console.error("\n❌ Insufficient balance for deployment. Need at least 0.01 HYPE.");
    process.exit(1);
  }

  // Deploy Executor606BaXt
  console.log("\nDeploying Executor606BaXt...");
  const Executor = await hre.ethers.getContractFactory("Executor606BaXt");
  const executor = await Executor.deploy(deployer.address);
  await executor.waitForDeployment();

  const executorAddress = await executor.getAddress();
  console.log("✓ Executor606BaXt deployed to:", executorAddress);

  // Verify owner
  const owner = await executor.owner();
  console.log("✓ Owner set to:", owner);

  // Write deployment info to JSON
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const deploymentInfo = {
    network: hre.network.name,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    morphoExecutor: executorAddress,
    owner: owner,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: executor.deploymentTransaction()?.hash,
  };

  const deploymentPath = path.join(deploymentsDir, "hyperEvm.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("✓ Deployment info written to:", deploymentPath);

  console.log("\n========================================");
  console.log("  Deployment Complete!");
  console.log("========================================");
  console.log("\nNext steps:");
  console.log(`1. Add to .env: EXECUTOR_ADDRESS_999=${executorAddress}`);
  console.log("2. Fund the executor with loan tokens for liquidations");
  console.log("3. Enable execution: EXECUTION_ENABLED=1");
  console.log("========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
