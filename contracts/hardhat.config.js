require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: "0.8.20",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            viaIR: true,
        },
    },
    networks: {
        hyperEvm: {
            accounts: [process.env.PRIVATE_KEY_MAINNET],
            chainId: 999,
            url: 'https://rpc.hyperliquid.xyz/evm',
        }
    },
};
