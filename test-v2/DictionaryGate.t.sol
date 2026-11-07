// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {EtherMan} from "../contracts-v2/EtherMan.sol";
import {MockDictionaryVerifier} from "./MockDictionaryVerifier.sol";

interface GateVm {
    function deal(address account, uint256 amount) external;
    function prank(address sender) external;
    function chainId(uint256 id) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert() external;
}

contract MutatingVerifier {
    uint256 public calls;
    function verify(bytes calldata, bytes32[] calldata) external returns (bool) {
        calls++;
        return true;
    }
}

contract MalformedVerifier {
    fallback() external {
        // A valid ABI bool must be zero or one, not two.
        assembly { mstore(0, 2) return(0, 32) }
    }
}

/// @dev Verifier-boundary tests use mocks. Real cryptographic acceptance and
/// rejection are covered separately using the generated Solidity verifier.
contract DictionaryGateTest {
    GateVm private constant vm = GateVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 private constant STAKE = 0.001 ether;
    address private constant CREATOR = address(0xA11CE);
    address private constant CHALLENGER = address(0xB0B);
    bytes32 private constant ROOT = bytes32(uint256(123));
    bytes32 private constant SALT = keccak256("synthetic gate fixture");
    MockDictionaryVerifier private verifier;
    EtherMan private game;

    function setUp() public {
        verifier = new MockDictionaryVerifier();
        game = new EtherMan(address(verifier), ROOT);
        vm.deal(CREATOR, 1 ether);
        vm.deal(CHALLENGER, 1 ether);
        vm.deal(address(this), 1 ether);
    }

    function _inputs(bytes32 commitment, address creator, uint8 length) private view returns (bytes32[] memory inputs) {
        inputs = new bytes32[](8);
        inputs[0] = ROOT;
        inputs[1] = bytes32(block.chainid >> 128);
        inputs[2] = bytes32(uint256(uint128(block.chainid)));
        inputs[3] = bytes32(uint256(uint160(address(game))));
        inputs[4] = bytes32(uint256(uint160(creator)));
        inputs[5] = bytes32(uint256(length));
        inputs[6] = bytes32(uint256(commitment) >> 128);
        inputs[7] = bytes32(uint256(uint128(uint256(commitment))));
    }

    function _unchanged(bytes32 commitment) private view {
        require(game.nextGameId() == 1, "failed proof allocated ID");
        require(game.totalEscrow() == 0 && game.totalCredits() == 0, "failed proof changed accounting");
        require(address(game).balance == 0, "failed proof retained ETH");
        require(!game.usedCommitments(commitment), "failed proof consumed commitment");
    }

    function _open(bytes32 commitment) private returns (uint256) {
        vm.prank(CREATOR);
        return game.createGame{value: STAKE}(commitment, 3, 3, new bytes(8768));
    }

    function testConstructorRejectsMissingCodeAndNonCanonicalRoots() public {
        vm.expectRevert(EtherMan.InvalidDictionaryConfiguration.selector);
        new EtherMan(address(0), ROOT);
        vm.expectRevert(EtherMan.InvalidDictionaryConfiguration.selector);
        new EtherMan(CREATOR, ROOT);
        vm.expectRevert(EtherMan.InvalidDictionaryConfiguration.selector);
        new EtherMan(address(verifier), bytes32(0));
        vm.expectRevert(EtherMan.InvalidDictionaryConfiguration.selector);
        new EtherMan(address(verifier), bytes32(PRIME));
        vm.expectRevert(EtherMan.InvalidDictionaryConfiguration.selector);
        new EtherMan(address(verifier), bytes32(type(uint256).max));
        EtherMan boundary = new EtherMan(address(verifier), bytes32(PRIME - 1));
        require(boundary.dictionaryRoot() == bytes32(PRIME - 1), "root changed");
        require(boundary.dictionaryVerifier() == address(verifier), "verifier changed");
    }

    function testWrongProofSizesAreRejectedWithoutStateChanges() public {
        bytes32 commitment = SALT;
        for (uint256 i; i < 3; ++i) {
            uint256 length = i == 0 ? 0 : i == 1 ? 8767 : 8769;
            vm.prank(CREATOR);
            vm.expectRevert(EtherMan.InvalidDictionaryProof.selector);
            game.createGame{value: STAKE}(commitment, 3, 3, new bytes(length));
            _unchanged(commitment);
        }
    }

    function testFalseAndRevertingVerifiersFailClosedWithoutConsumingCommitment() public {
        bytes32 commitment = SALT;
        verifier.configure(false, false, 0, false);
        vm.expectRevert(EtherMan.InvalidDictionaryProof.selector);
        _open(commitment);
        _unchanged(commitment);
        verifier.configure(true, true, 0, false);
        vm.expectRevert(EtherMan.InvalidDictionaryProof.selector);
        _open(commitment);
        _unchanged(commitment);
        verifier.configure(true, false, 0, false);
        require(_open(commitment) == 1, "valid retry failed");
    }

    function testVerifierCannotMutateStateUnderStaticCall() public {
        MutatingVerifier malicious = new MutatingVerifier();
        game = new EtherMan(address(malicious), ROOT);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.InvalidDictionaryProof.selector);
        game.createGame{value: STAKE, gas: 200_000}(SALT, 3, 3, new bytes(8768));
        _unchanged(SALT);
        require(malicious.calls() == 0, "verifier mutated state");
    }

    function testMalformedVerifierReturnFailsClosed() public {
        game = new EtherMan(address(new MalformedVerifier()), ROOT);
        vm.expectRevert();
        _open(SALT);
        _unchanged(SALT);
    }

    function testEveryPublicInputIsBoundIncludingFullCommitmentLimbs() public {
        // Foundry limits chain IDs to uint64; the expected high limb is zero.
        // Mutating that limb must still reject, and the nonzero high commitment
        // limb independently exercises full-width splitting.
        vm.chainId(type(uint64).max);
        bytes32 commitment = bytes32((uint256(13) << 128) | 42);
        for (uint256 i; i < 8; ++i) {
            bytes32[] memory inputs = _inputs(commitment, CREATOR, 3);
            inputs[i] = bytes32(uint256(inputs[i]) + 1);
            verifier.configure(true, false, keccak256(abi.encode(inputs)), true);
            vm.expectRevert(EtherMan.InvalidDictionaryProof.selector);
            _open(commitment);
            _unchanged(commitment);
        }
        verifier.configure(true, false, keccak256(abi.encode(_inputs(commitment, CREATOR, 3))), true);
        require(_open(commitment) == 1, "matching inputs rejected");
    }

    function testCopiedProofCannotChangeCreatorOrLength() public {
        bytes32 commitment = SALT;
        verifier.configure(true, false, keccak256(abi.encode(_inputs(commitment, CREATOR, 3))), true);
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.InvalidDictionaryProof.selector);
        game.createGame{value: STAKE}(commitment, 3, 3, new bytes(8768));
        _unchanged(commitment);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.InvalidDictionaryProof.selector);
        game.createGame{value: STAKE}(commitment, 4, 3, new bytes(8768));
        _unchanged(commitment);
        _open(commitment);
    }

    function testCommitmentReplayRejectedBeforeAndAfterCancellation() public {
        bytes32 commitment = game.computeCommitment(CREATOR, "cat", SALT);
        uint256 id = _open(commitment);
        vm.expectRevert(EtherMan.CommitmentAlreadyUsed.selector);
        _open(commitment);
        vm.prank(CREATOR);
        game.cancelGame(id);
        vm.expectRevert(EtherMan.CommitmentAlreadyUsed.selector);
        _open(commitment);
        require(game.nextGameId() == 2 && game.totalEscrow() == 0, "replay changed state");
        require(game.credits(CREATOR) == STAKE, "replay changed credit");
        bytes32 fresh = game.computeCommitment(CREATOR, "cat", bytes32(uint256(SALT) ^ 1));
        require(_open(fresh) == 2, "fresh salt rejected");
    }

    function testCommitmentReplayRejectedAfterSettlement() public {
        bytes32 commitment = game.computeCommitment(CREATOR, "cat", SALT);
        uint256 id = _open(commitment);
        vm.prank(CHALLENGER);
        game.joinGame{value: STAKE}(id);
        vm.prank(CHALLENGER);
        game.concede(id);
        vm.prank(CREATOR);
        game.reveal(id, "cat", SALT);
        vm.expectRevert(EtherMan.CommitmentAlreadyUsed.selector);
        _open(commitment);
        require(game.usedCommitments(commitment), "settlement unconsumed commitment");
        require(game.nextGameId() == 2 && game.totalEscrow() == 0, "replay changed state");
        require(game.credits(CREATOR) == STAKE * 2, "replay changed credit");
    }
}
