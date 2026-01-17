// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IMorpho.sol";
import "../interfaces/IPrjxSwapRouter.sol";

/**
 * @title IWHYPE
 * @notice Interface for Wrapped HYPE token
 */
interface IWHYPE {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title MorphoFlashloanExecutorV2
 * @notice Executor with Morpho flashloan callback support for atomic liquidations
 * @dev V2: Converts all profits to native HYPE for gas-aware profitability
 * 
 * Flow:
 * 1. Flashloan loan token from Morpho
 * 2. Execute liquidation (repay debt, receive collateral)
 * 3. Swap collateral → loan token (via LiquidSwap, encoded in calls)
 * 4. Repay flashloan
 * 5. Swap remaining loan token profit → WHYPE (via Project X)
 * 6. Unwrap WHYPE → HYPE
 * 7. Send HYPE profit to treasury
 * 
 * Security features:
 * - OnlyOwner: Only the deployer (bot EOA) can execute calls
 * - ReentrancyGuard: Prevents reentrancy attacks
 * - Callback validation: Only Morpho can call onMorphoFlashLoan
 * - Expected flashloan validation: Ensures callback matches initiated flashloan
 */
contract MorphoFlashloanExecutorV2 is Ownable, ReentrancyGuard, IMorphoFlashLoanCallback {
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
     * @notice Profit swap parameters for converting loan token to HYPE
     * @param router Project X swap router address
     * @param feeTier Pool fee tier (e.g., 500 = 0.05%)
     * @param minHypeOut Minimum HYPE output (slippage protection)
     */
    struct ProfitSwapParams {
        address router;
        uint24 feeTier;
        uint256 minHypeOut;
    }

    /**
     * @notice Flashloan callback data structure
     * @param loanToken Token being borrowed via flashloan
     * @param assets Amount borrowed
     * @param calls Array of calls to execute during callback (liquidation + collateral swap)
     * @param treasury Address to send HYPE profits to
     * @param profitSwap Parameters for swapping profit to HYPE
     * @param skipProfitSwap If true, skip profit swap (for markets where loanToken is WHYPE)
     */
    struct FlashCallbackData {
        address loanToken;
        uint256 assets;
        Call[] calls;
        address treasury;
        ProfitSwapParams profitSwap;
        bool skipProfitSwap;
    }

    /// @notice Morpho Blue contract address (immutable)
    address public immutable morpho;
    
    /// @notice WHYPE token address (immutable)
    address public immutable whype;

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
        address indexed loanToken,
        uint256 borrowed,
        uint256 hypeProfit
    );

    /**
     * @notice Emitted when HYPE is sent to treasury
     */
    event ProfitSent(address indexed treasury, uint256 amount);

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
    
    /// @notice Thrown when insufficient balance to repay flashloan
    error InsufficientBalance(uint256 actual, uint256 required);
    
    /// @notice Thrown when HYPE profit is below minimum
    error InsufficientHypeProfit(uint256 actual, uint256 minimum);
    
    /// @notice Thrown when HYPE transfer to treasury fails
    error HypeTransferFailed();

    /**
     * @notice Constructor
     * @param initialOwner The address that will own this executor
     * @param _morpho Morpho Blue contract address
     * @param _whype WHYPE token address
     */
    constructor(address initialOwner, address _morpho, address _whype) Ownable(initialOwner) {
        morpho = _morpho;
        whype = _whype;
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
    // Flashloan Mode V2 (HYPE profits)
    // ========================================

    /**
     * @notice Initiate flashloan-powered execution with HYPE profit conversion
     * @dev Calls Morpho flashLoan, which triggers onMorphoFlashLoan callback
     * @param token Token to borrow
     * @param assets Amount to borrow
     * @param calls Calls to execute inside callback (liquidation + collateral swap)
     * @param treasury Address to receive HYPE profits
     * @param profitSwap Parameters for profit → HYPE swap
     * @param skipProfitSwap Set true if loanToken is already WHYPE
     */
    function flashV2(
        address token,
        uint256 assets,
        Call[] calldata calls,
        address treasury,
        ProfitSwapParams calldata profitSwap,
        bool skipProfitSwap
    ) external onlyOwner nonReentrant {
        // Set expected values for callback validation
        _expectedToken = token;
        _expectedAssets = assets;
        _inFlashloan = true;

        // Record HYPE balance before
        uint256 hypeBalanceBefore = address(this).balance;

        // Encode callback data
        bytes memory data = abi.encode(
            FlashCallbackData({
                loanToken: token,
                assets: assets,
                calls: calls,
                treasury: treasury,
                profitSwap: profitSwap,
                skipProfitSwap: skipProfitSwap
            })
        );

        // Initiate flashloan - Morpho will call onMorphoFlashLoan
        IMorpho(morpho).flashLoan(token, assets, data);

        // Clear expected values
        _expectedToken = address(0);
        _expectedAssets = 0;
        _inFlashloan = false;

        // Calculate HYPE profit
        uint256 hypeProfit = address(this).balance - hypeBalanceBefore;

        emit FlashloanExecuted(msg.sender, token, assets, hypeProfit);
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

        // Execute the call plan (liquidation + collateral swap)
        _executeCalls(cbData.calls);

        // Get loan token balance after swaps
        uint256 loanBalance = IERC20(cbData.loanToken).balanceOf(address(this));
        
        // Ensure we have enough to repay flashloan
        if (loanBalance < assets) {
            revert InsufficientBalance(loanBalance, assets);
        }

        // Approve Morpho to pull flashloan repayment
        IERC20(cbData.loanToken).forceApprove(morpho, assets);

        // Calculate profit in loan token
        uint256 loanProfit = loanBalance - assets;

        // Convert profit to HYPE (if there's profit and we should swap)
        if (loanProfit > 0 && !cbData.skipProfitSwap) {
            _swapProfitToHype(cbData.loanToken, loanProfit, cbData.profitSwap);
        } else if (loanProfit > 0 && cbData.skipProfitSwap) {
            // loanToken is WHYPE, just unwrap
            IWHYPE(whype).withdraw(loanProfit);
        }

        // Send HYPE profit to treasury
        uint256 hypeBalance = address(this).balance;
        if (hypeBalance > 0 && cbData.treasury != address(0)) {
            // Check minimum HYPE out (only if we did a swap)
            if (!cbData.skipProfitSwap && hypeBalance < cbData.profitSwap.minHypeOut) {
                revert InsufficientHypeProfit(hypeBalance, cbData.profitSwap.minHypeOut);
            }
            
            (bool success, ) = payable(cbData.treasury).call{value: hypeBalance}("");
            if (!success) {
                revert HypeTransferFailed();
            }
            emit ProfitSent(cbData.treasury, hypeBalance);
        }

        // Morpho will pull `assets` after this callback returns
    }

    /**
     * @notice Swap loan token profit to WHYPE then unwrap to HYPE
     * @param loanToken The loan token to swap from
     * @param amount Amount of loan token to swap
     * @param params Swap parameters
     */
    function _swapProfitToHype(
        address loanToken,
        uint256 amount,
        ProfitSwapParams memory params
    ) internal {
        // Approve router to spend loan token
        IERC20(loanToken).forceApprove(params.router, amount);

        // Swap loan token → WHYPE via Project X
        IPrjxSwapRouter.ExactInputSingleParams memory swapParams = IPrjxSwapRouter.ExactInputSingleParams({
            tokenIn: loanToken,
            tokenOut: whype,
            fee: params.feeTier,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: amount,
            amountOutMinimum: 0, // We check minHypeOut after unwrap
            sqrtPriceLimitX96: 0
        });

        IPrjxSwapRouter(params.router).exactInputSingle(swapParams);

        // Unwrap all WHYPE to HYPE
        uint256 whypeBalance = IWHYPE(whype).balanceOf(address(this));
        if (whypeBalance > 0) {
            IWHYPE(whype).withdraw(whypeBalance);
        }
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
