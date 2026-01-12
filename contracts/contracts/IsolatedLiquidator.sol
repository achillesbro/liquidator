// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IPool } from "./interfaces/IPool.sol";
import { IHyperlendIsolatedPair } from "./interfaces/IHyperlendIsolatedPair.sol";
import { IPrjxSwapRouter } from "./interfaces/IPrjxSwapRouter.sol";

/**
 * @title IsolatedLiquidator
 * @notice Liquidates positions in HyperLend Isolated Pairs using Core Pool flashloans
 * 
 * Flow:
 * 1. Flashloan USDC from Core Pool
 * 2. Liquidate isolated pair position (xHYPE/USDC)
 * 3. Swap seized xHYPE to USDC via ProjectX UniV3 (fee=100)
 * 4. Repay flashloan (amount + premium)
 * 5. Keep profit in contract
 */
contract IsolatedLiquidator is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IPool public immutable pool;
    IHyperlendIsolatedPair public immutable pair;
    IERC20 public immutable USDC;
    IERC20 public immutable XHYPE;
    IPrjxSwapRouter public immutable prjxRouter;
    
    uint24 public constant PRJX_FEE = 100; // 0.01%

    /**
     * @notice Safe approval helper - sets allowance to 0 then to amount
     * @dev Prevents safeApprove revert when existing allowance is non-zero
     */
    function _approveExact(IERC20 token, address spender, uint256 amount) internal {
        token.approve(spender, 0);
        token.approve(spender, amount);
    }

    event LiquidationExecuted(
        address indexed borrower,
        uint128 sharesToLiquidate,
        uint256 repayAmount,
        uint256 premium,
        uint256 seizedXHype,
        uint256 usdcOut,
        uint256 profitUsdc
    );

    struct LiquidationParams {
        address borrower;
        uint128 sharesToLiquidate;
        uint256 minUsdcOut;
        uint256 deadline;
    }

    constructor(
        address _pool,
        address _pair,
        address _usdc,
        address _prjxRouter
    ) Ownable(msg.sender) {
        pool = IPool(_pool);
        pair = IHyperlendIsolatedPair(_pair);
        USDC = IERC20(_usdc);
        prjxRouter = IPrjxSwapRouter(_prjxRouter);
        
        // Discover xHYPE address from pair
        XHYPE = IERC20(pair.collateralContract());
        
        // Validate pair configuration
        require(pair.asset() == _usdc, "Pair asset != USDC");
    }

    /**
     * @notice Execute liquidation
     * @param borrower The borrower address to liquidate
     * @param sharesToLiquidate Number of borrow shares to liquidate
     * @param minUsdcOut Minimum USDC output from swap (with slippage applied)
     * @param deadline Transaction deadline timestamp
     */
    function run(
        address borrower,
        uint128 sharesToLiquidate,
        uint256 minUsdcOut,
        uint256 deadline
    ) external onlyOwner nonReentrant {
        // Compute repayAmount from shares
        uint256 repayAmount = pair.toBorrowAmount(sharesToLiquidate, true, true);
        
        // Encode params for flashloan callback
        LiquidationParams memory liqParams = LiquidationParams({
            borrower: borrower,
            sharesToLiquidate: sharesToLiquidate,
            minUsdcOut: minUsdcOut,
            deadline: deadline
        });
        bytes memory params = abi.encode(liqParams);
        
        // Execute flashloan
        pool.flashLoanSimple(address(this), address(USDC), repayAmount, params, 0);
    }

    /**
     * @notice Flashloan callback - executes liquidation and swap
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == address(pool), "msg.sender != pool");
        require(initiator == address(this), "initiator != address(this)");
        require(asset == address(USDC), "asset != USDC");

        LiquidationParams memory liqParams = abi.decode(params, (LiquidationParams));

        // Track USDC balance before liquidation to prevent existing balance from subsidizing bad swaps
        uint256 usdcBefore = USDC.balanceOf(address(this));

        // Approve pair for exact repayAmount
        _approveExact(USDC, address(pair), amount);

        // Record xHYPE balance before liquidation
        uint256 xHypeBalanceBefore = XHYPE.balanceOf(address(this));

        // Liquidate isolated pair position
        pair.liquidate(
            liqParams.sharesToLiquidate,
            liqParams.deadline,
            liqParams.borrower
        );

        // Get actual xHYPE balance after liquidation
        uint256 xHypeBalanceAfter = XHYPE.balanceOf(address(this));
        uint256 seizedXHype = xHypeBalanceAfter - xHypeBalanceBefore;

        // Compute repayTotal and clamp minOut
        uint256 repayTotal = amount + premium;
        uint256 minOut = liqParams.minUsdcOut;
        if (minOut < repayTotal) {
            minOut = repayTotal;
        }

        // Swap all seized xHYPE to USDC via ProjectX
        uint256 usdcOut = 0;
        if (seizedXHype > 0) {
            _approveExact(XHYPE, address(prjxRouter), seizedXHype);
            
            IPrjxSwapRouter.ExactInputSingleParams memory swapParams = IPrjxSwapRouter.ExactInputSingleParams({
                tokenIn: address(XHYPE),
                tokenOut: address(USDC),
                fee: PRJX_FEE,
                recipient: address(this),
                deadline: liqParams.deadline,
                amountIn: seizedXHype,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            });
            
            usdcOut = prjxRouter.exactInputSingle(swapParams);
        }

        // Repay flashloan: approve pool for amount + premium
        _approveExact(USDC, address(pool), repayTotal);

        // Verify swap output covers repayment (using delta, not absolute balance)
        uint256 usdcAfter = USDC.balanceOf(address(this));
        require(usdcAfter - usdcBefore >= repayTotal, "swap output < repay");
        
        // Calculate profit from swap delta only
        uint256 profitUsdc = (usdcAfter - usdcBefore) - repayTotal;

        emit LiquidationExecuted(
            liqParams.borrower,
            liqParams.sharesToLiquidate,
            amount,
            premium,
            seizedXHype,
            usdcOut,
            profitUsdc
        );

        return true;
    }

    /**
     * @notice Rescue tokens from contract (profit extraction)
     */
    function rescueTokens(address _token, uint256 _amount, bool _max, address _to) external onlyOwner {
        if (_token == address(0)) {
            if (_max) _amount = address(this).balance;
            (bool success, ) = payable(_to).call{value: _amount}("");
            require(success, "transfer failed");
        } else {
            if (_max) _amount = IERC20(_token).balanceOf(address(this));
            IERC20(_token).safeTransfer(_to, _amount);
        }
    }
}
