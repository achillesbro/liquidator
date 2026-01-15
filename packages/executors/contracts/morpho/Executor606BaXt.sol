// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Executor606BaXt
 * @notice Minimal owned executor for batched calls
 * @dev Uses exec_606BaXt function signature compatible with executooor-style bots
 * 
 * Security features:
 * - OnlyOwner: Only the deployer (bot EOA) can execute calls
 * - ReentrancyGuard: Prevents reentrancy attacks during call execution
 * - Sequential execution: Calls are executed in order, reverts on any failure
 */
contract Executor606BaXt is Ownable, ReentrancyGuard {
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
     * @notice Emitted when a batch of calls is executed
     * @param sender The address that initiated the execution
     * @param callCount The number of calls executed
     */
    event BatchExecuted(address indexed sender, uint256 callCount);

    /**
     * @notice Emitted when ETH is received
     * @param sender The address that sent ETH
     * @param amount The amount of ETH received
     */
    event Received(address indexed sender, uint256 amount);

    /**
     * @notice Constructor sets the owner
     * @param initialOwner The address that will own this executor
     */
    constructor(address initialOwner) Ownable(initialOwner) {}

    /**
     * @notice Execute a batch of calls
     * @dev Reverts if any call fails, bubbling up the revert reason
     * @param calls Array of Call structs to execute in order
     */
    function exec_606BaXt(Call[] calldata calls) external onlyOwner nonReentrant {
        uint256 len = calls.length;
        
        for (uint256 i = 0; i < len; ) {
            Call calldata c = calls[i];
            
            (bool success, bytes memory returnData) = c.target.call{value: c.value}(c.data);
            
            if (!success) {
                // Bubble up the revert reason
                if (returnData.length > 0) {
                    assembly {
                        let returnDataSize := mload(returnData)
                        revert(add(32, returnData), returnDataSize)
                    }
                } else {
                    revert("Executor: call failed");
                }
            }
            
            unchecked {
                ++i;
            }
        }
        
        emit BatchExecuted(msg.sender, len);
    }

    /**
     * @notice Rescue ERC20 tokens stuck in the contract
     * @dev Only callable by owner
     * @param token The token address to rescue
     * @param to The recipient address
     * @param amount The amount to transfer
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        (bool success, bytes memory returnData) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        require(success && (returnData.length == 0 || abi.decode(returnData, (bool))), "Executor: rescue failed");
    }

    /**
     * @notice Rescue ETH stuck in the contract
     * @dev Only callable by owner
     * @param to The recipient address
     * @param amount The amount to transfer
     */
    function rescueETH(address payable to, uint256 amount) external onlyOwner {
        (bool success, ) = to.call{value: amount}("");
        require(success, "Executor: ETH rescue failed");
    }

    /**
     * @notice Allow contract to receive ETH
     */
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    /**
     * @notice Fallback for ETH transfers with data
     */
    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}
