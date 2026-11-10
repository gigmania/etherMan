// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @dev Fully configurable raw return words for fail-closed feed boundary tests.
contract MockSequencerFeed {
    uint256[5] private data;
    bool private broken;
    uint256 private returnBytes = 160;

    constructor() {
        data = [uint256(1), 0, block.timestamp, block.timestamp, 1];
    }

    function configure(uint256 round, uint256 answer, uint256 startedAt, uint256 updatedAt, uint256 answeredInRound) external {
        data = [round, answer, startedAt, updatedAt, answeredInRound];
    }

    function malfunction(bool shouldRevert, uint256 length) external {
        broken = shouldRevert;
        returnBytes = length;
    }

    fallback() external {
        require(!broken, "feed unavailable");
        uint256[5] memory values = data;
        uint256 length = returnBytes;
        assembly { return(values, length) }
    }
}
