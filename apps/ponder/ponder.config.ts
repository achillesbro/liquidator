import { createConfig } from "ponder";

import { morphoBlueAbi } from "./abis/MorphoBlue";

// Morpho Blue on HyperEVM
const MORPHO_BLUE_ADDRESS = "0x68e37dE8d93d3496ae143F2E900490f6280C57cD" as const;
const MORPHO_BLUE_START_BLOCK = 1988429;

export default createConfig({
  chains: {
    hyperevm: {
      id: 999,
      rpc: process.env.RPC_URL_999 ?? "https://rpc.hyperliquid.xyz/evm",
    },
  },
  contracts: {
    MorphoBlue: {
      abi: morphoBlueAbi,
      chain: {
        hyperevm: {
          address: MORPHO_BLUE_ADDRESS,
          startBlock: MORPHO_BLUE_START_BLOCK,
        },
      },
    },
  },
  database: {
    kind: "postgres",
    connectionString:
      process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ponder",
  },
});
