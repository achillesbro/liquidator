main()

async function main(){
    // Update CONTRACT_ADDRESS to the deployed IsolatedLiquidator address
    const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000";
    const liq = await ethers.getContractAt("IsolatedLiquidator", CONTRACT_ADDRESS);
    
    // Update token address and recipient as needed
    const TOKEN = process.env.TOKEN || '0xb88339CB7199b77E23DB6E890353E22632Ba630f'; // USDC
    const RECIPIENT = process.env.PROFIT_RECEIVER || '0x0000000000000000000000000000000000000000';
    
    const tx = await liq.rescueTokens(TOKEN, 0, true, RECIPIENT);
    console.log("Rescue tx:", tx.hash);
    await tx.wait();
    console.log("Rescue confirmed");
}
