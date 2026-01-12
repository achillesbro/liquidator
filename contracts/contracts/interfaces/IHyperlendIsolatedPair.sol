// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

interface IHyperlendIsolatedPair {
    function asset() external view returns (address);
    
    function collateralContract() external view returns (address);
    
    function getUserSnapshot(address user) external view returns (
        uint256 userAssetShares,
        uint256 userBorrowShares,
        uint256 userCollateralBalance
    );
    
    function toBorrowAmount(uint256 shares, bool roundUp, bool previewInterest) external view returns (uint256);
    
    function toBorrowShares(uint256 amount, bool roundUp, bool previewInterest) external view returns (uint256);
    
    function liquidate(uint128 sharesToLiquidate, uint256 deadline, address borrower) external returns (uint256 collateralForLiquidator);
}
