// Market configurations for isolated liquidation markets

const XHYPE_USDC_MARKET = {
    id: "XHYPE_USDC",
    pairAddress: '0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd',
    oracleAddress: process.env.ORACLE_ADDRESS_XHYPE_USDC || '0x896970EB7FB914eFcDfaDA4CFFC3E3C31497Da5a',
    collateralAddress: '0xAc962FA04BF91B7fd0DC0c5C32414E0Ce3C51E03', // xHYPE (optional, can be read from pair)
    assetAddress: '0xb88339CB7199b77E23DB6E890353E22632Ba630f', // USDC (optional, can be read from pair)
    collateralDecimals: 18,
    assetDecimals: 6,
    swap: {
        kind: "univ3",
        router: '0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B', // ProjectX Router
        quoter: '0x239F11a7A3E08f2B8110D4CA9F6B95d4c8865258', // ProjectX Quoter
        fee: 100, // 0.01%
        poolAddress: '0x6a76bd79bd97ffe55eb87c701f9ae8a1e3d7254e'
    }
};

const WHLP_USDT0_MARKET = {
    id: "WHLP_USDT0",
    pairAddress: '0x06Fd9D03b3d0F18E4919919b72D30c582f0a97E5',
    oracleAddress: '0xE0d0528707a5dc63329EC4993f58E35D77AE4eD0',
    collateralAddress: '0x1359b05241cA5076c9F59605214f4F84114c0dE8', // wHLP (optional, can be read from pair)
    assetAddress: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', // USDT0 (optional, can be read from pair)
    collateralDecimals: 18,
    assetDecimals: 6,
    swap: {
        kind: "univ3",
        router: '0x6D99e7f6747AF2cDbB5164b6DD50e40D4fDe1e77', // HyperSwap V3 SwapRouter02
        quoter: '0x03A918028f22D9E1473B7959C927AD7425A45C7C', // HyperSwap QuoterV2
        fee: 500, // 0.05%
        poolAddress: '0x859235541c19a3b26436fe7ecddf22142d8dccae'
    }
};

module.exports = {
    XHYPE_USDC_MARKET,
    WHLP_USDT0_MARKET,
    // Export all markets as an array for iteration
    MARKETS: [XHYPE_USDC_MARKET, WHLP_USDT0_MARKET]
};
