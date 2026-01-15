// ProjectX contract ABIs for swap verification

const FACTORY_ABI = [
    "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];

const POOL_ABI = [
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
];

// Router ABI - supports both tuple-style (SwapRouter02) and flat-args signatures
// We'll detect which one exists at runtime
const ROUTER_ABI = [
    // Tuple-style (SwapRouter02): exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))
    "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
    // Flat-args style (older SwapRouter): exactInputSingle(address,address,uint24,address,uint256,uint256,uint256,uint160)
    "function exactInputSingle(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) external payable returns (uint256 amountOut)"
];

const ERC20_ABI = [
    "function balanceOf(address account) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function decimals() external view returns (uint8)"
];

module.exports = {
    FACTORY_ABI,
    POOL_ABI,
    ROUTER_ABI,
    ERC20_ABI
};
