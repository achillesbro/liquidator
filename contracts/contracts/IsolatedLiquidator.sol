// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IPool } from "./interfaces/IPool.sol";
import { IHyperlendIsolatedPair } from "./interfaces/IHyperlendIsolatedPair.sol";
import { IUniV3SwapRouter } from "./interfaces/IUniV3SwapRouter.sol";

/**
 * @title IsolatedLiquidator
 * @notice Liquidates positions in HyperLend Isolated Pairs using Core Pool flashloans
 * 
 * Flow:
 * 1. Flashloan asset token from Core Pool
 * 2. Liquidate isolated pair position
 * 3. Swap seized collateral to asset token via UniV3-compatible router
 * 4. Repay flashloan (amount + premium)
 * 5. Keep profit in contract
 */
contract IsolatedLiquidator is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IPool public immutable pool;
    IHyperlendIsolatedPair public immutable pair;
    IERC20 public immutable ASSET;
    IERC20 public immutable COLLATERAL;
    IUniV3SwapRouter public immutable swapRouter;
    uint24 public immutable fee;

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
        uint256 seizedCollateral,
        uint256 assetOut,
        uint256 profitAsset
    );

    struct LiquidationParams {
        address borrower;
        uint128 sharesToLiquidate;
        uint256 minAssetOut;
        uint256 deadline;
    }

    constructor(
        address _pool,
        address _pair,
        address _asset,
        address _swapRouter,
        uint24 _fee
    ) Ownable(msg.sender) {
        pool = IPool(_pool);
        pair = IHyperlendIsolatedPair(_pair);
        ASSET = IERC20(_asset);
        swapRouter = IUniV3SwapRouter(_swapRouter);
        fee = _fee;
        
        // Discover collateral address from pair
        COLLATERAL = IERC20(pair.collateralContract());
        
        // Validate pair configuration
        require(pair.asset() == _asset, "pair asset != asset");
    }

    /**
     * @notice Execute liquidation
     * @param borrower The borrower address to liquidate
     * @param sharesToLiquidate Number of borrow shares to liquidate
     * @param minAssetOut Minimum asset output from swap (with slippage applied)
     * @param deadline Transaction deadline timestamp
     */
    function run(
        address borrower,
        uint128 sharesToLiquidate,
        uint256 minAssetOut,
        uint256 deadline
    ) external onlyOwner nonReentrant {
        // Compute repayAmount from shares
        uint256 repayAmount = pair.toBorrowAmount(sharesToLiquidate, true, true);
        
        // Encode params for flashloan callback
        LiquidationParams memory liqParams = LiquidationParams({
            borrower: borrower,
            sharesToLiquidate: sharesToLiquidate,
            minAssetOut: minAssetOut,
            deadline: deadline
        });
        bytes memory params = abi.encode(liqParams);
        
        // Execute flashloan
        pool.flashLoanSimple(address(this), address(ASSET), repayAmount, params, 0);
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
        require(asset == address(ASSET), "asset != ASSET");

        LiquidationParams memory liqParams = abi.decode(params, (LiquidationParams));

        // Track asset balance before liquidation to prevent existing balance from subsidizing bad swaps
        uint256 assetBefore = ASSET.balanceOf(address(this));

        // Approve pair for exact repayAmount
        _approveExact(ASSET, address(pair), amount);

        // Record collateral balance before liquidation
        uint256 collateralBalanceBefore = COLLATERAL.balanceOf(address(this));

        // Liquidate isolated pair position
        pair.liquidate(
            liqParams.sharesToLiquidate,
            liqParams.deadline,
            liqParams.borrower
        );

        // Get actual collateral balance after liquidation
        uint256 collateralBalanceAfter = COLLATERAL.balanceOf(address(this));
        uint256 seizedCollateral = collateralBalanceAfter - collateralBalanceBefore;

        // Compute repayTotal and clamp minOut
        uint256 repayTotal = amount + premium;
        uint256 minOut = liqParams.minAssetOut;
        if (minOut < repayTotal) {
            minOut = repayTotal;
        }

        // Swap all seized collateral to asset via UniV3-compatible router
        uint256 assetOut = 0;
        if (seizedCollateral > 0) {
            _approveExact(COLLATERAL, address(swapRouter), seizedCollateral);
            
            IUniV3SwapRouter.ExactInputSingleParams memory swapParams = IUniV3SwapRouter.ExactInputSingleParams({
                tokenIn: address(COLLATERAL),
                tokenOut: address(ASSET),
                fee: fee,
                recipient: address(this),
                deadline: liqParams.deadline,
                amountIn: seizedCollateral,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            });
            
            assetOut = swapRouter.exactInputSingle(swapParams);
        }

        // Repay flashloan: approve pool for amount + premium
        _approveExact(ASSET, address(pool), repayTotal);

        // Verify swap output covers repayment (using delta, not absolute balance)
        uint256 assetAfter = ASSET.balanceOf(address(this));
        require(assetAfter - assetBefore >= repayTotal, "swap output < repay");
        
        // Calculate profit from swap delta only
        uint256 profitAsset = (assetAfter - assetBefore) - repayTotal;

        emit LiquidationExecuted(
            liqParams.borrower,
            liqParams.sharesToLiquidate,
            amount,
            premium,
            seizedCollateral,
            assetOut,
            profitAsset
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
