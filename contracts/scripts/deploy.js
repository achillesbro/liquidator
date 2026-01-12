main()

async function main(){
    const Contract = await ethers.getContractFactory("IsolatedLiquidator");
    
    // Constructor args: pool, pair, usdc, prjxRouter
    const POOL = '0x00A89d7a5A02160f20150EbEA7a2b5E4879A1A8b';
    const PAIR = '0x78DD09e369f35D033a1d4ec1df39BC8a51c8B6fd';
    const USDC = '0xb88339CB7199b77E23DB6E890353E22632Ba630f';
    const PRJX_ROUTER = '0x1EbDFC75FfE3ba3de61E7138a3E8706aC841Af9B';
    
    const contract = await Contract.deploy(POOL, PAIR, USDC, PRJX_ROUTER);
    console.log("IsolatedLiquidator deployed to:", contract.target)
}
