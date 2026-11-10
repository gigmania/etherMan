// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @dev Test-only uptime simulation. Deployment is forbidden outside local chain 31337.
contract LocalSequencerFeed {
    address public immutable owner;
    uint80 private roundId = 1;
    bool private down;
    uint256 private startedAt;
    uint256 private updatedAt;

    error LocalOnly();
    error Unauthorized();

    constructor() {
        if (block.chainid != 31337) revert LocalOnly();
        owner = msg.sender;
        startedAt = updatedAt = block.timestamp;
    }

    function setDown(bool status) external {
        if (msg.sender != owner) revert Unauthorized();
        if (status != down) {
            down = status;
            roundId++;
            startedAt = block.timestamp;
        }
        updatedAt = block.timestamp;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, down ? int256(1) : int256(0), startedAt, updatedAt, roundId);
    }
}
