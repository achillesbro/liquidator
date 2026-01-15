// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IMorpho.sol";

/**
 * @title MorphoFlashloanExecutor606BaXt
 * @notice Executor with Morpho flashloan callback support for atomic liquidations
 * @dev Supports both prefunded execution (exec_606BaXt) and flashloan execution (flash_606BaXt)
 * 
 * Security features:
 * - OnlyOwner: Only the deployer (bot EOA) can execute calls
 * - ReentrancyGuard: Prevents reentrancy attacks
 * - Callback validation: Only Morpho can call onMorphoFlashLoan
 * - Expected flashloan validation: Ensures callback matches initiated flashloan
 */
contract MorphoFlashloanExecutor606BaXt is Ownable, ReentrancyGuard, IMorphoFlashLoanCallback {
    using SafeERC20 for IERC20;

    /**
     * @notice Call struct for batched execution
     * @param target The address to call
     * @param value The ETH value to send with the call
     * @param data The calldata to execute
     */
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    /**
     * @notice Flashloan callback data structure
     * @param loanToken Token being borrowed via flashloan
     * @param assets Amount borrowed
     * @param calls Array of calls to execute during callback
     * @param treasury Address to send profits to
     * @param minProfit Minimum profit required (in loan token)
     */
    struct FlashCallbackData {
        address loanToken;
        uint256 assets;
        Call[] calls;
        address treasury;
        uint256 minProfit;
    }

    /// @notice Morpho Blue contract address (immutable)
    address public immutable morpho;

    /// @notice Expected flashloan token (set during flashloan initiation)
    address private _expectedToken;
    
    /// @notice Expected flashloan amount (set during flashloan initiation)
    uint256 private _expectedAssets;
    
    /// @notice Flag to indicate we're in a flashloan context
    bool private _inFlashloan;

    /**
     * @notice Emitted when a batch of calls is executed (prefunded mode)
     */
    event BatchExecuted(address indexed sender, uint256 callCount);

    /**
     * @notice Emitted when a flashloan liquidation is executed
     */
    event FlashloanExecuted(
        address indexed sender,
        address indexed token,
        uint256 borrowed,
        uint256 repaid,
        uint256 profit
    );

    /**
     * @notice Emitted when ETH is received
     */
    event Received(address indexed sender, uint256 amount);

    /// @notice Thrown when caller is not Morpho in callback
    error OnlyMorpho();
    
    /// @notice Thrown when flashloan parameters don't match expected
    error UnexpectedFlashloan();
    
    /// @notice Thrown when a call in the batch fails
    error CallFailed(uint256 index, bytes reason);
    
    /// @notice Thrown when profit is below minimum
    error InsufficientProfit(uint256 actual, uint256 minimum);

    /**
     * @notice Constructor
     * @param initialOwner The address that will own this executor
     * @param _morpho Morpho Blue contract address
     */
    constructor(address initialOwner, address _morpho) Ownable(initialOwner) {
        morpho = _morpho;
    }

    // ========================================
    // Prefunded Mode (Milestone 3 compatible)
    // ========================================

    /**
     * @notice Execute a batch of calls (prefunded mode)
     * @dev Identical to original Executor606BaXt behavior
     * @param calls Array of Call structs to execute in order
     */
    function exec_606BaXt(Call[] calldata calls) external onlyOwner nonReentrant {
        _executeCalls(calls);
        emit BatchExecuted(msg.sender, calls.length);
    }

    // ========================================
    // Flashloan Mode (Milestone 4)
    // ========================================

    /**
     * @notice Initiate flashloan-powered execution
     * @dev Calls Morpho flashLoan, which triggers onMorphoFlashLoan callback
     * @param token Token to borrow
     * @param assets Amount to borrow
     * @param calls Calls to execute inside callback
     * @param treasury Address to receive profits
     * @param minProfit Minimum profit required (reverts if not met)
     */
    function flash_606BaXt(
        address token,
        uint256 assets,
        Call[] calldata calls,
        address treasury,
        uint256 minProfit
    ) external onlyOwner nonReentrant {
        // Set expected values for callback validation
        _expectedToken = token;
        _expectedAssets = assets;
        _inFlashloan = true;

        // Encode callback data
        bytes memory data = abi.encode(
            FlashCallbackData({
                loanToken: token,
                assets: assets,
                calls: calls,
                treasury: treasury,
                minProfit: minProfit
            })
        );

        // Record balance before
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));

        // Initiate flashloan - Morpho will call onMorphoFlashLoan
        IMorpho(morpho).flashLoan(token, assets, data);

        // Clear expected values
        _expectedToken = address(0);
        _expectedAssets = 0;
        _inFlashloan = false;

        // Calculate profit (balance delta after repayment)
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        uint256 profit = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;

        emit FlashloanExecuted(msg.sender, token, assets, assets, profit);
    }

    /**
     * @notice Morpho flashloan callback
     * @dev Called by Morpho Blue during flashLoan execution
     * @param assets Amount of tokens received
     * @param data Encoded FlashCallbackData
     */
    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external override {
        // Validate caller is Morpho
        if (msg.sender != morpho) {
            revert OnlyMorpho();
        }

        // Validate we initiated this flashloan
        if (!_inFlashloan) {
            revert UnexpectedFlashloan();
        }

        // Decode callback data
        FlashCallbackData memory cbData = abi.decode(data, (FlashCallbackData));

        // Validate flashloan parameters match what we initiated
        if (cbData.loanToken != _expectedToken || assets != _expectedAssets) {
            revert UnexpectedFlashloan();
        }

        // Execute the call plan (liquidation + swap)
        _executeCalls(cbData.calls);

        // Ensure we have enough to repay
        uint256 balance = IERC20(cbData.loanToken).balanceOf(address(this));
        if (balance < assets) {
            revert InsufficientProfit(balance, assets);
        }

        // Approve Morpho to pull repayment
        IERC20(cbData.loanToken).forceApprove(morpho, assets);

        // Calculate remaining profit
        uint256 profit = balance - assets;

        // Check minimum profit requirement
        if (profit < cbData.minProfit) {
            revert InsufficientProfit(profit, cbData.minProfit);
        }

        // Transfer profit to treasury
        if (profit > 0 && cbData.treasury != address(0)) {
            IERC20(cbData.loanToken).safeTransfer(cbData.treasury, profit);
        }

        // Morpho will pull `assets` after this callback returns
    }

    // ========================================
    // Internal Functions
    // ========================================

    /**
     * @notice Execute array of calls
     * @dev Reverts if any call fails, bubbling up revert reason
     * @param calls Array of calls to execute
     */
    function _executeCalls(Call[] memory calls) internal {
        uint256 len = calls.length;
        
        for (uint256 i = 0; i < len; ) {
            Call memory c = calls[i];
            
            (bool success, bytes memory returnData) = c.target.call{value: c.value}(c.data);
            
            if (!success) {
                revert CallFailed(i, returnData);
            }
            
            unchecked {
                ++i;
            }
        }
    }

    // ========================================
    // Rescue Functions
    // ========================================

    /**
     * @notice Rescue ERC20 tokens stuck in the contract
     * @param token The token address to rescue
     * @param to The recipient address
     * @param amount The amount to transfer
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @notice Rescue ETH stuck in the contract
     * @param to The recipient address
     * @param amount The amount to transfer
     */
    function rescueETH(address payable to, uint256 amount) external onlyOwner {
        (bool success, ) = to.call{value: amount}("");
        require(success, "ETH rescue failed");
    }

    // ========================================
    // Receive ETH
    // ========================================

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}
