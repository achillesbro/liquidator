// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IMorpho
 * @notice Minimal interface for Morpho Blue flashloan and liquidation
 */

struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

interface IMorpho {
    /**
     * @notice Flash loan tokens from Morpho Blue
     * @param token The token to borrow
     * @param assets The amount to borrow
     * @param data Arbitrary data passed to the callback
     */
    function flashLoan(address token, uint256 assets, bytes calldata data) external;

    /**
     * @notice Liquidate an underwater position
     * @param marketParams Market parameters
     * @param borrower Borrower address
     * @param seizedAssets Amount of collateral to seize
     * @param repaidShares Amount of debt shares to repay
     * @param data Callback data (empty for liquidators)
     * @return seizedAssets_ Actual seized collateral
     * @return repaidAssets Actual repaid debt in asset terms
     */
    function liquidate(
        MarketParams memory marketParams,
        address borrower,
        uint256 seizedAssets,
        uint256 repaidShares,
        bytes memory data
    ) external returns (uint256 seizedAssets_, uint256 repaidAssets);
}

/**
 * @title IMorphoFlashLoanCallback
 * @notice Interface for Morpho Blue flashloan callback
 */
interface IMorphoFlashLoanCallback {
    /**
     * @notice Callback called by Morpho Blue during flashLoan
     * @param assets The amount of tokens borrowed
     * @param data Arbitrary data passed from flashLoan call
     */
    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external;
}
