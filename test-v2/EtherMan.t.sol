// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {DictionaryConfig} from "../contracts-v2/generated/DictionaryConfig.sol";
import {EtherMan} from "../contracts-v2/EtherMan.sol";
import {MockSequencerFeed} from "./MockSequencerFeed.sol";
import {MockDictionaryVerifier} from "./MockDictionaryVerifier.sol";

interface Vm {
    function deal(address account, uint256 balance) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
}

contract RejectingPlayer {
    EtherMan private immutable game;
    constructor(EtherMan instance) { game = instance; }
    function openAndCancel() external payable {
        uint256 id = game.createGame{value: msg.value}(bytes32(uint256(1)), 3, 3, new bytes(DictionaryConfig.PROOF_BYTES));
        game.cancelGame(id);
    }
    function withdraw(address payable recipient) external { game.withdrawTo(recipient); }
    receive() external payable { revert("reject"); }
}

contract ReenteringPlayer {
    EtherMan private immutable game;
    bool public blocked;
    constructor(EtherMan instance) { game = instance; }
    function attack() external payable {
        uint256 id = game.createGame{value: msg.value}(bytes32(uint256(1)), 3, 3, new bytes(DictionaryConfig.PROOF_BYTES));
        game.cancelGame(id);
        game.withdrawTo(payable(address(this)));
    }
    receive() external payable {
        (bool success, bytes memory reason) = address(game).call(abi.encodeCall(game.withdrawTo, (payable(address(this)))));
        blocked = !success && bytes4(reason) == EtherMan.Reentrancy.selector;
    }
}

contract EtherManTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CREATOR = address(0xA11CE);
    address private constant CHALLENGER = address(0xB0B);
    address private constant OUTSIDER = address(0xBAD);
    bytes32 private constant SALT = keccak256("test-only-salt");
    uint256 private constant STAKE = 0.1 ether;
    EtherMan private game;

    function setUp() public {
        game = new EtherMan(address(new MockDictionaryVerifier()), bytes32(uint256(1)), address(new MockSequencerFeed()));
        vm.deal(CREATOR, 100 ether);
        vm.deal(CHALLENGER, 100 ether);
        vm.deal(OUTSIDER, 100 ether);
        vm.deal(address(this), 100 ether);
    }

    function _open(string memory word, uint8 length, uint8 misses) private returns (uint256 id) {
        bytes32 commitment = game.computeCommitment(CREATOR, word, _salt(game.nextGameId()));
        vm.prank(CREATOR);
        id = game.createGame{value: STAKE}(commitment, length, misses, new bytes(DictionaryConfig.PROOF_BYTES));
    }

    function _salt(uint256 id) private pure returns (bytes32) {
        return id == 1 ? SALT : keccak256(abi.encode(SALT, id));
    }

    function _join(uint256 id) private {
        vm.prank(CHALLENGER);
        game.joinGame{value: STAKE}(id);
    }

    function _turn(uint256 id, uint8 letter, uint32 mask) private {
        vm.prank(CHALLENGER);
        game.guess(id, letter);
        vm.prank(CREATOR);
        game.respond(id, letter, mask);
    }

    function _reveal(uint256 id, string memory word) private {
        vm.prank(CREATOR);
        game.reveal(id, word, _salt(id));
    }

    function _assertAccounting() private view {
        require(game.totalEscrow() + game.totalCredits() == address(game).balance, "accounting");
    }

    function _positions(string memory word, uint8 letter) private pure returns (uint32 mask) {
        bytes memory letters = bytes(word);
        for (uint256 i; i < letters.length; ++i) {
            if (uint8(letters[i]) == letter + 97) mask |= uint32(uint256(1) << i);
        }
    }

    function testTwoLetterWordCanCompleteAndSettle() public {
        uint256 id = _open("aa", 2, 3);
        _join(id);
        _turn(id, 0, 3);
        require(game.getGame(id).state == EtherMan.State.AwaitReveal, "two-letter full mask");
        _reveal(id, "aa");
        require(game.getGame(id).winner == CHALLENGER, "two-letter winner");
        require(game.credits(CHALLENGER) == 2 * STAKE, "two-letter pot");
        _assertAccounting();
    }

    function testLongestDictionaryWordCompletesAllPositionsAndWithdraws() public {
        string memory word = "ethylenediaminetetraacetates";
        require(bytes(word).length == DictionaryConfig.MAX_WORD_LENGTH, "longest fixture drift");
        uint256 id = _open(word, uint8(bytes(word).length), 3);
        _join(id);
        for (uint8 letter; letter < 26; ++letter) {
            uint32 mask = _positions(word, letter);
            if (mask != 0) _turn(id, letter, mask);
        }
        EtherMan.Game memory info = game.getGame(id);
        require(info.revealedMask == 0x0fffffff, "all 28 positions retained");
        require(info.state == EtherMan.State.AwaitReveal, "long word awaits reveal");
        (uint8[] memory letters, uint32[] memory masks) = game.getGuesses(id);
        uint32 transcriptMask;
        for (uint256 i; i < masks.length; ++i) {
            require(masks[i] == _positions(word, letters[i]), "wide transcript preserved");
            transcriptMask |= masks[i];
        }
        require(transcriptMask == info.revealedMask, "complete transcript");
        _reveal(id, word);
        require(game.getGame(id).winner == CHALLENGER, "long word challenger wins");
        require(keccak256(bytes(game.getGame(id).finalWord)) == keccak256(bytes(word)), "long word stored");
        require(game.credits(CHALLENGER) == STAKE * 2, "long word pot");
        uint256 beforeBalance = CHALLENGER.balance;
        vm.prank(CHALLENGER);
        game.withdrawTo(payable(CHALLENGER));
        require(CHALLENGER.balance == beforeBalance + STAKE * 2, "long word withdrawal");
        _assertAccounting();
    }

    function testLongestWordCreatorWinsWithHonestHighPositionResponse() public {
        string memory word = "ethylenediaminetetraacetates";
        uint256 id = _open(word, 28, 1);
        _join(id);
        uint32 lastLetterMask = _positions(word, 18); // s at position 27
        require(lastLetterMask == uint32(1) << 27, "high-position fixture");
        vm.prank(CHALLENGER);
        game.guess(id, 18);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.InvalidInput.selector);
        game.respond(id, 18, uint32(1) << 28);
        vm.prank(CREATOR);
        game.respond(id, 18, lastLetterMask);
        _turn(id, 25, 0); // z absent, exhaust misses
        _reveal(id, word);
        require(game.getGame(id).winner == CREATOR, "honest high-position response accepted");
        uint256 beforeBalance = CREATOR.balance;
        vm.prank(CREATOR);
        game.withdrawTo(payable(CREATOR));
        require(CREATOR.balance == beforeBalance + STAKE * 2, "creator withdrawal");
        _assertAccounting();
    }

    function testOmittingHighestPositionLosesOnReveal() public {
        string memory word = "ethylenediaminetetraacetates";
        uint256 id = _open(word, 28, 1);
        _join(id);
        _turn(id, 18, 0); // dishonest omission of s at bit 27
        _reveal(id, word);
        require(game.getGame(id).winner == CHALLENGER, "highest position checked during reveal");
        require(game.credits(CHALLENGER) == STAKE * 2, "dishonesty pot");
        _assertAccounting();
    }

    function testChallengerWinsAllLettersAndWithdrawsOnce() public {
        uint256 id = _open("banana", 6, 3);
        _join(id);
        _turn(id, 1, 1); // b
        _turn(id, 0, 42); // a
        _turn(id, 13, 20); // n
        require(game.getGame(id).state == EtherMan.State.AwaitReveal, "await reveal");
        _reveal(id, "banana");
        require(game.getGame(id).winner == CHALLENGER, "winner");
        require(game.credits(CHALLENGER) == 2 * STAKE, "pot");
        require(keccak256(bytes(game.getGame(id).finalWord)) == keccak256("banana"), "word");
        _assertAccounting();
        uint256 beforeBalance = CHALLENGER.balance;
        vm.prank(CHALLENGER);
        game.withdrawTo(payable(CHALLENGER));
        require(CHALLENGER.balance == beforeBalance + STAKE * 2, "withdrawal");
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.NoCredit.selector);
        game.withdrawTo(payable(CHALLENGER));
        _assertAccounting();
    }

    function testCreatorWinsAtMaximumMisses() public {
        uint256 id = _open("banana", 6, 2);
        _join(id);
        _turn(id, 23, 0); // x
        _turn(id, 24, 0); // y
        _reveal(id, "banana");
        require(game.getGame(id).winner == CREATOR, "creator winner");
        require(game.credits(CREATOR) == 2 * STAKE, "creator pot");
        _assertAccounting();
    }

    function testChallengerConcedesButCreatorMustReveal() public {
        uint256 id = _open("banana", 6, 3);
        _join(id);
        vm.prank(CHALLENGER);
        game.concede(id);
        require(game.credits(CREATOR) == 0, "no premature payout");
        _reveal(id, "banana");
        require(game.getGame(id).winner == CREATOR, "creator winner");
    }

    function testDishonestMaskLosesAfterConcession() public {
        uint256 id = _open("banana", 6, 3);
        _join(id);
        _turn(id, 0, 2); // omits the other a occurrences
        vm.prank(CHALLENGER);
        game.concede(id);
        _reveal(id, "banana");
        require(game.getGame(id).winner == CHALLENGER, "omission must lose");
    }

    function testDishonestCreatorCannotWinByChallengerTimeout() public {
        uint256 id = _open("banana", 6, 3);
        _join(id);
        _turn(id, 0, 0); // claims a is absent
        vm.warp(game.getGame(id).deadline + 1);
        vm.prank(OUTSIDER);
        game.claimTimeout(id);
        require(game.getGame(id).state == EtherMan.State.AwaitReveal, "must prove transcript");
        require(game.credits(CREATOR) == 0, "no premature payout");
        _reveal(id, "banana");
        require(game.getGame(id).winner == CHALLENGER, "dishonest creator loses");
    }

    function testHonestCreatorWinsAfterChallengerTimeoutAndReveal() public {
        uint256 id = _open("banana", 6, 3);
        _join(id);
        _turn(id, 0, 42);
        vm.warp(game.getGame(id).deadline + 1);
        game.claimTimeout(id);
        _reveal(id, "banana");
        require(game.getGame(id).winner == CREATOR, "honest timeout winner");
    }

    function testFabricatedFullMaskStillLosesOnReveal() public {
        uint256 id = _open("banana", 6, 3);
        _join(id);
        _turn(id, 23, 63);
        _reveal(id, "banana");
        require(game.getGame(id).winner == CHALLENGER, "fabrication loses");
    }

    // Mock-only defense-in-depth: a real dictionary proof rejects these creations.
    function testInvalidCommittedWordAndWrongLengthLose() public {
        uint256 id = _open("BANANA", 6, 3);
        _join(id);
        vm.prank(CHALLENGER);
        game.concede(id);
        _reveal(id, "BANANA");
        require(game.getGame(id).winner == CHALLENGER, "invalid canonical word loses");
        require(bytes(game.getGame(id).finalWord).length == 0, "invalid word not stored");

        uint256 other = _open("banana", 3, 3);
        _join(other);
        vm.prank(CHALLENGER);
        game.concede(other);
        _reveal(other, "banana");
        require(game.getGame(other).winner == CHALLENGER, "wrong length loses");
    }

    function testWrongOpeningCanBeRetriedWithoutSettlement() public {
        uint256 id = _open("banana", 6, 3);
        _join(id);
        vm.prank(CHALLENGER);
        game.concede(id);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.InvalidCommitment.selector);
        game.reveal(id, "banano", SALT);
        require(game.getGame(id).state == EtherMan.State.AwaitReveal, "still revealable");
        _reveal(id, "banana");
        require(game.getGame(id).winner == CREATOR, "retry succeeds");
    }

    function testCreatorResponseTimeoutAwardsChallenger() public {
        uint256 id = _open("banana", 6, 3);
        _join(id);
        vm.prank(CHALLENGER);
        game.guess(id, 0);
        vm.warp(game.getGame(id).deadline + 1);
        game.claimTimeout(id);
        require(game.getGame(id).winner == CHALLENGER, "response timeout");
        require(game.credits(CHALLENGER) == 2 * STAKE, "pot");
    }

    function testCreatorRevealTimeoutAwardsChallenger() public {
        uint256 id = _open("banana", 6, 1);
        _join(id);
        _turn(id, 23, 0);
        vm.warp(game.getGame(id).deadline + 1);
        game.claimTimeout(id);
        require(game.getGame(id).winner == CHALLENGER, "reveal timeout");
    }

    function testOpenCancellationAndExpiryRefundOnlyCreator() public {
        uint256 id = _open("banana", 6, 3);
        vm.prank(CREATOR);
        game.cancelGame(id);
        uint256 other = _open("banana", 6, 3);
        vm.warp(game.getGame(other).deadline + 1);
        vm.prank(OUTSIDER);
        game.claimTimeout(other);
        require(game.credits(CREATOR) == 2 * STAKE, "refunds");
        require(game.credits(OUTSIDER) == 0, "no bounty");
        require(other == id + 1, "monotonic IDs");
        _assertAccounting();
    }

    function testExactDepositsAndDistinctParticipants() public {
        uint256 id = _open("banana", 6, 3);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.Unauthorized.selector);
        game.joinGame{value: STAKE}(id);
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.InvalidStake.selector);
        game.joinGame{value: STAKE - 1}(id);
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.InvalidStake.selector);
        game.joinGame{value: STAKE + 1}(id);
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.InvalidStake.selector);
        game.joinGame(id);
        _join(id);
        vm.prank(OUTSIDER);
        vm.expectRevert(EtherMan.InvalidState.selector);
        game.joinGame{value: STAKE}(id);
        _assertAccounting();
    }

    function testUnknownGamesAndCreationBounds() public {
        vm.expectRevert(EtherMan.UnknownGame.selector);
        game.getGame(0);
        vm.expectRevert(EtherMan.UnknownGame.selector);
        game.getGuesses(1);
        vm.expectRevert(EtherMan.InvalidInput.selector);
        game.createGame{value: STAKE}(bytes32(0), 3, 3, new bytes(DictionaryConfig.PROOF_BYTES));
        vm.expectRevert(EtherMan.InvalidInput.selector);
        game.createGame{value: STAKE}(SALT, 0, 3, new bytes(DictionaryConfig.PROOF_BYTES));
        vm.expectRevert(EtherMan.InvalidInput.selector);
        game.createGame{value: STAKE}(SALT, DictionaryConfig.MAX_WORD_LENGTH + 1, 3, new bytes(DictionaryConfig.PROOF_BYTES));
        vm.expectRevert(EtherMan.InvalidInput.selector);
        game.createGame{value: STAKE}(SALT, 3, 0, new bytes(DictionaryConfig.PROOF_BYTES));
        vm.expectRevert(EtherMan.InvalidInput.selector);
        game.createGame{value: STAKE}(SALT, 3, 9, new bytes(DictionaryConfig.PROOF_BYTES));
        vm.expectRevert(EtherMan.InvalidStake.selector);
        game.createGame(SALT, 3, 3, new bytes(DictionaryConfig.PROOF_BYTES));
        vm.expectRevert(EtherMan.InvalidStake.selector);
        game.createGame{value: 1 ether + 1}(SALT, 3, 3, new bytes(DictionaryConfig.PROOF_BYTES));
        game.createGame{value: 1}(SALT, DictionaryConfig.MAX_WORD_LENGTH, 8, new bytes(DictionaryConfig.PROOF_BYTES));
        game.createGame{value: 1 ether}(bytes32(uint256(2)), 3, 1, new bytes(DictionaryConfig.PROOF_BYTES));
    }

    function testAuthorizationDuplicatesAndResponseBounds() public {
        uint256 id = _open("banana", 6, 3);
        vm.prank(OUTSIDER);
        vm.expectRevert(EtherMan.Unauthorized.selector);
        game.cancelGame(id);
        _join(id);
        vm.prank(OUTSIDER);
        vm.expectRevert(EtherMan.Unauthorized.selector);
        game.guess(id, 0);
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.InvalidInput.selector);
        game.guess(id, 26);
        vm.prank(OUTSIDER);
        vm.expectRevert(EtherMan.Unauthorized.selector);
        game.concede(id);
        vm.prank(CHALLENGER);
        game.guess(id, 0);
        vm.prank(OUTSIDER);
        vm.expectRevert(EtherMan.Unauthorized.selector);
        game.respond(id, 0, 42);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.InvalidInput.selector);
        game.respond(id, 0, 64);
        vm.prank(CREATOR);
        game.respond(id, 0, 42);
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.AlreadyGuessed.selector);
        game.guess(id, 0);
        vm.prank(CHALLENGER);
        game.guess(id, 1);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.InvalidInput.selector);
        game.respond(id, 1, 2); // position already assigned to a
    }

    function testOnlyCreatorRevealsAndOnlyAwaitReveal() public {
        uint256 id = _open("banana", 6, 3);
        _join(id);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.InvalidState.selector);
        game.reveal(id, "banana", SALT);
        vm.prank(CHALLENGER);
        game.concede(id);
        vm.prank(OUTSIDER);
        vm.expectRevert(EtherMan.Unauthorized.selector);
        game.reveal(id, "banana", SALT);
    }

    function testExactDeadlinePermitsActionButNotTimeout() public {
        uint256 id = _open("banana", 6, 3);
        vm.warp(game.getGame(id).deadline);
        vm.expectRevert(EtherMan.NotExpired.selector);
        game.claimTimeout(id);
        _join(id);
        vm.warp(game.getGame(id).deadline);
        vm.expectRevert(EtherMan.NotExpired.selector);
        game.claimTimeout(id);
        vm.prank(CHALLENGER);
        game.guess(id, 0);
        vm.warp(game.getGame(id).deadline);
        vm.prank(CREATOR);
        game.respond(id, 0, 42);
    }

    function testExpiredActionsCannotRaceTimeout() public {
        uint256 id = _open("banana", 6, 3);
        vm.warp(game.getGame(id).deadline + 1);
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.Expired.selector);
        game.joinGame{value: STAKE}(id);
        uint256 other = _open("banana", 6, 3);
        _join(other);
        vm.warp(game.getGame(other).deadline + 1);
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.Expired.selector);
        game.guess(other, 0);
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.Expired.selector);
        game.concede(other);
        game.claimTimeout(other);
        vm.warp(game.getGame(other).deadline + 1);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.Expired.selector);
        game.reveal(other, "banana", SALT);
    }

    function testSettledAndCancelledGamesCannotPayTwice() public {
        uint256 id = _open("banana", 6, 1);
        _join(id);
        _turn(id, 23, 0);
        _reveal(id, "banana");
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.InvalidState.selector);
        game.reveal(id, "banana", SALT);
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.InvalidState.selector);
        game.guess(id, 0);
        vm.expectRevert(EtherMan.InvalidState.selector);
        game.claimTimeout(id);
        uint256 other = _open("banana", 6, 3);
        vm.prank(CREATOR);
        game.cancelGame(other);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.InvalidState.selector);
        game.cancelGame(other);
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.InvalidState.selector);
        game.joinGame{value: STAKE}(other);
        require(game.credits(CREATOR) == STAKE * 3, "only owed credit");
        _assertAccounting();
    }

    function testGuessesOnlyContainCompletedResponses() public {
        uint256 id = _open("banana", 6, 3);
        _join(id);
        vm.prank(CHALLENGER);
        game.guess(id, 0);
        (uint8[] memory letters, uint32[] memory masks) = game.getGuesses(id);
        require(letters.length == 0 && masks.length == 0, "no uncompleted response");
        require(game.getGame(id).pendingLetter == 0, "pending a");
        vm.prank(CREATOR);
        game.respond(id, 0, 42);
        (letters, masks) = game.getGuesses(id);
        require(letters.length == 1 && masks.length == 1 && letters[0] == 0 && masks[0] == 42, "transcript");
        require(game.getGame(id).pendingLetter == 26, "no pending letter");
    }

    function testStaleResponseCannotAnswerNextLetter() public {
        uint256 id = _open("cat", 3, 3);
        _join(id);
        _turn(id, 25, 0); // z is absent
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.InvalidState.selector);
        game.respond(id, 25, 0); // immediate duplicate

        vm.prank(CHALLENGER);
        game.guess(id, 2); // c is now pending
        EtherMan.Game memory beforeGame = game.getGame(id);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.InvalidInput.selector);
        game.respond(id, 25, 0); // delayed retry of the old z response
        EtherMan.Game memory afterGame = game.getGame(id);
        require(afterGame.state == EtherMan.State.CreatorTurn, "turn unchanged");
        require(afterGame.pendingLetter == 2, "c remains pending");
        require(afterGame.deadline == beforeGame.deadline, "deadline unchanged");
        require(afterGame.misses == beforeGame.misses, "misses unchanged");
        require(afterGame.revealedMask == beforeGame.revealedMask, "positions unchanged");
        (uint8[] memory letters, uint32[] memory masks) = game.getGuesses(id);
        require(letters.length == 1 && masks.length == 1 && letters[0] == 25 && masks[0] == 0, "transcript unchanged");

        vm.prank(CREATOR);
        game.respond(id, 2, 1);
        _turn(id, 0, 2); // a
        _turn(id, 19, 4); // t
        _reveal(id, "cat");
        require(game.getGame(id).winner == CHALLENGER, "honest completed game");
        require(game.credits(CHALLENGER) == STAKE * 2, "correct pot");
        _assertAccounting();
    }

    function testRejectingWithdrawalPreservesCreditAndAlternateRecipientWorks() public {
        RejectingPlayer player = new RejectingPlayer(game);
        player.openAndCancel{value: STAKE}();
        vm.expectRevert(EtherMan.TransferFailed.selector);
        player.withdraw(payable(address(player)));
        require(game.credits(address(player)) == STAKE, "credit preserved");
        _assertAccounting();
        uint256 beforeBalance = OUTSIDER.balance;
        player.withdraw(payable(OUTSIDER));
        require(OUTSIDER.balance == beforeBalance + STAKE, "alternate recipient");
        _assertAccounting();
    }

    function testWithdrawalsCannotStealOtherPlayersCreditOrUseInvalidRecipient() public {
        uint256 id = _open("banana", 6, 3);
        vm.prank(CREATOR);
        game.cancelGame(id);
        vm.prank(OUTSIDER);
        vm.expectRevert(EtherMan.NoCredit.selector);
        game.withdrawTo(payable(CREATOR));
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.InvalidInput.selector);
        game.withdrawTo(payable(address(0)));
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.InvalidInput.selector);
        game.withdrawTo(payable(address(game)));
        require(game.credits(CREATOR) == STAKE, "credit remains");
    }

    function testWithdrawalReentrancyIsBlocked() public {
        ReenteringPlayer player = new ReenteringPlayer(game);
        player.attack{value: STAKE}();
        require(player.blocked(), "reentry blocked");
        require(address(player).balance == STAKE, "one payment");
        require(game.credits(address(player)) == 0, "debited");
        _assertAccounting();
    }

    function testCommitmentDomainSeparatesCreatorAndContract() public {
        bytes32 original = game.computeCommitment(CREATOR, "banana", SALT);
        require(original == keccak256(abi.encode(block.chainid, address(game), CREATOR, "banana", SALT)), "ABI encoding");
        require(original != game.computeCommitment(CHALLENGER, "banana", SALT), "creator domain");
        EtherMan other = new EtherMan(address(new MockDictionaryVerifier()), bytes32(uint256(1)), address(new MockSequencerFeed()));
        require(original != other.computeCommitment(CREATOR, "banana", SALT), "contract domain");
    }

    function testFuzzValidResponseMasksMatchCommittedWord(uint8 letterSeed, uint32 responseSeed) public {
        uint8 letter = letterSeed % 26;
        uint32 mask = responseSeed % 64;
        uint256 id = _open("banana", 6, 3);
        _join(id);
        _turn(id, letter, mask);
        if (game.getGame(id).state == EtherMan.State.ChallengerTurn) {
            vm.prank(CHALLENGER);
            game.concede(id);
        }
        _reveal(id, "banana");
        uint32 expected = letter == 0 ? 42 : letter == 1 ? 1 : letter == 13 ? 20 : 0;
        address expectedWinner = mask == expected ? CREATOR : CHALLENGER;
        require(game.getGame(id).winner == expectedWinner, "transcript winner");
        _assertAccounting();
    }

    function testFuzzIndependentEscrowAndRefunds(uint96 firstSeed, uint96 secondSeed) public {
        uint256 firstStake = uint256(firstSeed) % 1 ether + 1;
        uint256 secondStake = uint256(secondSeed) % 1 ether + 1;
        vm.prank(CREATOR);
        uint256 first = game.createGame{value: firstStake}(SALT, 3, 3, new bytes(DictionaryConfig.PROOF_BYTES));
        vm.prank(CHALLENGER);
        uint256 second = game.createGame{value: secondStake}(bytes32(uint256(2)), 3, 3, new bytes(DictionaryConfig.PROOF_BYTES));
        vm.prank(CREATOR);
        game.cancelGame(first);
        vm.prank(CREATOR);
        game.withdrawTo(payable(CREATOR));
        require(game.totalEscrow() == secondStake, "other escrow intact");
        require(address(game).balance == secondStake, "other funds intact");
        vm.prank(CHALLENGER);
        game.cancelGame(second);
        _assertAccounting();
    }
}

/// @dev Bounded stateful handler; every economic actor is known to the invariant.
contract EtherManHandler {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    EtherMan public immutable game;
    address[4] public actors;
    mapping(uint256 => bytes32) private salts;

    constructor(EtherMan instance) {
        game = instance;
        for (uint256 i; i < 4; ++i) {
            actors[i] = address(uint160(100 + i));
            vm.deal(actors[i], 100_000 ether);
        }
    }

    function create(uint8 actorSeed, uint96 stakeSeed) external {
        if (game.nextGameId() > 64) return;
        address actor = actors[actorSeed % 4];
        bytes32 salt = keccak256(abi.encode(game.nextGameId(), actor));
        bytes32 commitment = game.computeCommitment(actor, "banana", salt);
        vm.prank(actor);
        uint256 id = game.createGame{value: uint256(stakeSeed) % 1 ether + 1}(commitment, 6, 3, new bytes(DictionaryConfig.PROOF_BYTES));
        salts[id] = salt;
    }

    function join(uint256 seed, uint8 actorSeed) external {
        uint256 id = _id(seed);
        if (id == 0) return;
        EtherMan.Game memory info = game.getGame(id);
        vm.prank(actors[actorSeed % 4]);
        try game.joinGame{value: info.stake}(id) {} catch {}
    }

    function guessLetter(uint256 seed, uint8 letter) external {
        uint256 id = _id(seed);
        if (id == 0) return;
        vm.prank(game.getGame(id).challenger);
        try game.guess(id, letter % 26) {} catch {}
    }

    function answer(uint256 seed, bool honest) external {
        uint256 id = _id(seed);
        if (id == 0) return;
        EtherMan.Game memory info = game.getGame(id);
        uint8 letter = info.pendingLetter;
        uint32 mask = letter == 0 ? 42 : letter == 1 ? 1 : letter == 13 ? 20 : 0;
        if (!honest) mask = (mask + 1) % 64;
        vm.prank(info.creator);
        try game.respond(id, letter, mask) {} catch {}
    }

    function finish(uint256 seed) external {
        uint256 id = _id(seed);
        if (id == 0) return;
        EtherMan.Game memory info = game.getGame(id);
        if (info.state == EtherMan.State.ChallengerTurn) {
            vm.prank(info.challenger);
            try game.concede(id) {} catch {}
        } else {
            vm.prank(info.creator);
            try game.reveal(id, "banana", salts[id]) {} catch {}
        }
    }

    function timeout(uint256 seed, uint32 elapsed) external {
        vm.warp(block.timestamp + uint256(elapsed) % 8 days);
        uint256 id = _id(seed);
        if (id == 0) return;
        try game.claimTimeout(id) {} catch {}
    }

    function cancel(uint256 seed) external {
        uint256 id = _id(seed);
        if (id == 0) return;
        vm.prank(game.getGame(id).creator);
        try game.cancelGame(id) {} catch {}
    }

    function withdraw(uint8 actorSeed) external {
        address actor = actors[actorSeed % 4];
        vm.prank(actor);
        try game.withdrawTo(payable(actor)) {} catch {}
    }

    function _id(uint256 seed) private view returns (uint256) {
        uint256 count = game.nextGameId() - 1;
        return count == 0 ? 0 : seed % count + 1;
    }
}

contract EtherManInvariantTest {
    EtherMan private game;
    EtherManHandler private handler;

    function setUp() public {
        game = new EtherMan(address(new MockDictionaryVerifier()), bytes32(uint256(1)), address(new MockSequencerFeed()));
        handler = new EtherManHandler(game);
    }

    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function invariantEscrowAndCreditsMatchFundsAndGameStates() public view {
        uint256 credited;
        for (uint256 i; i < 4; ++i) credited += game.credits(handler.actors(i));
        require(credited == game.totalCredits(), "credits reconcile");
        uint256 escrow;
        for (uint256 id = 1; id < game.nextGameId(); ++id) {
            EtherMan.Game memory info = game.getGame(id);
            require(game.usedCommitments(info.commitment), "created commitment remains consumed");
            if (info.state == EtherMan.State.Open) escrow += info.stake;
            else if (info.state != EtherMan.State.Settled && info.state != EtherMan.State.Cancelled) escrow += 2 * info.stake;
            if (info.state == EtherMan.State.Settled) {
                require(info.winner == info.creator || info.winner == info.challenger, "participant winner");
            }
        }
        require(escrow == game.totalEscrow(), "escrow reconciles");
        require(escrow + credited == address(game).balance, "solvent and conserved");
    }
}
