import { config as loadEnv } from "dotenv";
import { createConfig } from "ponder";
import { http } from "viem";
import MorphoBlueAbi from "./abis/MorphoBlue.json";

// Load .env file
loadEnv();

const RPC_URL_999 = process.env.RPC_URL_999 || "https://rpc.hyperliquid.xyz/evm";
const PORT = parseInt(process.env.PORT || "42069", 10);

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL!,
    schema: process.env.DATABASE_SCHEMA || "public",
  },
  networks: {
    hyperevm: {
      chainId: 999,
      transport: http(RPC_URL_999),
    },
  },
  contracts: {
    MorphoBlue: {
      network: "hyperevm",
      address: "0x68e37dE8d93d3496ae143F2E900490f6280C57cD",
      abi: MorphoBlueAbi,
      // Morpho Blue deployment block on HyperEVM
      startBlock: 1988429,
    },
  },
  options: {
    port: PORT,
  },
});
