// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

interface IPrjxQuoter {
    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    ) external returns (uint256 amountOut);
}
