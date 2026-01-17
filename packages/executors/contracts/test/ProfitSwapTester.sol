// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
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
 * @title ProfitSwapTester
 * @notice Test contract to verify the profit swap flow: loanToken → WHYPE → HYPE
 * @dev This isolates the swap logic from the full liquidation flow for testing
 */
contract ProfitSwapTester is Ownable {
    using SafeERC20 for IERC20;

    /// @notice WHYPE token address (immutable)
    address public immutable whype;

    /// @notice Emitted when a profit swap test is executed
    event ProfitSwapTested(
        address indexed loanToken,
        uint256 amountIn,
        uint256 whypeReceived,
        uint256 hypeReceived
    );

    /// @notice Emitted when HYPE is sent
    event HypeSent(address indexed to, uint256 amount);

    /// @notice Emitted when ETH is received
    event Received(address indexed sender, uint256 amount);

    constructor(address initialOwner, address _whype) Ownable(initialOwner) {
        whype = _whype;
    }

    /**
     * @notice Test the profit swap flow
     * @dev Caller must have approved this contract to spend loanToken
     * @param loanToken Token to swap from
     * @param amount Amount to swap
     * @param router Project X router address
     * @param feeTier Pool fee tier
     * @param recipient Address to receive HYPE (use address(0) to keep in contract)
     * @return whypeReceived Amount of WHYPE received from swap
     * @return hypeReceived Amount of HYPE received after unwrap
     */
    function testProfitSwap(
        address loanToken,
        uint256 amount,
        address router,
        uint24 feeTier,
        address recipient
    ) external onlyOwner returns (uint256 whypeReceived, uint256 hypeReceived) {
        // Pull tokens from caller
        IERC20(loanToken).safeTransferFrom(msg.sender, address(this), amount);

        // Record HYPE balance before
        uint256 hypeBefore = address(this).balance;

        // Check if loanToken is WHYPE (skip swap, just unwrap)
        if (loanToken == whype) {
            whypeReceived = amount;
            IWHYPE(whype).withdraw(amount);
        } else {
            // Approve router
            IERC20(loanToken).forceApprove(router, amount);

            // Swap loanToken → WHYPE
            IPrjxSwapRouter.ExactInputSingleParams memory swapParams = IPrjxSwapRouter.ExactInputSingleParams({
                tokenIn: loanToken,
                tokenOut: whype,
                fee: feeTier,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });

            whypeReceived = IPrjxSwapRouter(router).exactInputSingle(swapParams);

            // Unwrap all WHYPE to HYPE
            uint256 whypeBalance = IWHYPE(whype).balanceOf(address(this));
            if (whypeBalance > 0) {
                IWHYPE(whype).withdraw(whypeBalance);
            }
        }

        // Calculate HYPE received
        hypeReceived = address(this).balance - hypeBefore;

        emit ProfitSwapTested(loanToken, amount, whypeReceived, hypeReceived);

        // Send HYPE to recipient if specified
        if (recipient != address(0) && hypeReceived > 0) {
            (bool success, ) = payable(recipient).call{value: hypeReceived}("");
            require(success, "HYPE transfer failed");
            emit HypeSent(recipient, hypeReceived);
        }

        return (whypeReceived, hypeReceived);
    }

    /**
     * @notice Rescue ERC20 tokens stuck in the contract
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @notice Rescue ETH stuck in the contract
     */
    function rescueETH(address payable to, uint256 amount) external onlyOwner {
        (bool success, ) = to.call{value: amount}("");
        require(success, "ETH rescue failed");
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }
}
