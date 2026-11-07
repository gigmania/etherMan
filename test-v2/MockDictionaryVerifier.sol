// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @dev Fast game-state tests only. This is not dictionary-enforcement evidence.
/// Real-proof integration tests deploy the generated Solidity verifier.
contract MockDictionaryVerifier {
    bool public accepted = true;
    bool public shouldRevert;
    bool public checkInputs;
    bytes32 public expectedInputsHash;

    function configure(bool result, bool reverting, bytes32 inputsHash, bool enforceInputs) external {
        accepted = result;
        shouldRevert = reverting;
        expectedInputsHash = inputsHash;
        checkInputs = enforceInputs;
    }

    function verify(bytes calldata, bytes32[] calldata publicInputs) external view returns (bool) {
        if (shouldRevert) revert("test verifier failure");
        return accepted && (!checkInputs || keccak256(abi.encode(publicInputs)) == expectedInputsHash);
    }
}
