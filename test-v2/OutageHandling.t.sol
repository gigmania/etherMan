// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {EtherMan} from "../contracts-v2/EtherMan.sol";
import {DictionaryConfig} from "../contracts-v2/generated/DictionaryConfig.sol";
import {LocalSequencerFeed} from "../contracts-v2/test/LocalSequencerFeed.sol";
import {MockDictionaryVerifier} from "./MockDictionaryVerifier.sol";
import {MockSequencerFeed} from "./MockSequencerFeed.sol";

interface OutageVm {
    function deal(address account, uint256 amount) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function chainId(uint256 chainId) external;
    function expectRevert(bytes4 selector) external;
}

contract OutageHandlingTest {
    OutageVm private constant vm = OutageVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CREATOR = address(0xA11CE);
    address private constant CHALLENGER = address(0xB0B);
    address private constant OUTSIDER = address(0xBAD);
    uint256 private constant STAKE = 0.1 ether;
    MockSequencerFeed private feed;
    MockDictionaryVerifier private verifier;
    EtherMan private game;

    function setUp() public {
        vm.warp(1000);
        vm.deal(CREATOR, 100 ether);
        vm.deal(CHALLENGER, 100 ether);
        feed = new MockSequencerFeed();
        verifier = new MockDictionaryVerifier();
        game = new EtherMan(address(verifier), bytes32(uint256(1)), address(feed));
    }

    function _status(EtherMan.NetworkStatus expected) private view {
        (EtherMan.NetworkStatus actual,,) = game.getNetworkStatus();
        require(actual == expected, "network status");
    }

    function _accounting() private view {
        require(game.totalEscrow() + game.totalCredits() == address(game).balance, "escrow plus credits");
        require(game.credits(CREATOR) + game.credits(CHALLENGER) + game.credits(OUTSIDER) == game.totalCredits(), "credit sum");
    }

    function _open() private returns (uint256 id) {
        id = game.nextGameId();
        bytes32 commitment = game.computeCommitment(CREATOR, "cat", bytes32(id));
        vm.prank(CREATOR);
        require(game.createGame{value: STAKE}(commitment, 3, 3, new bytes(DictionaryConfig.PROOF_BYTES)) == id, "game id");
    }

    function _join(uint256 id) private {
        vm.prank(CHALLENGER);
        game.joinGame{value: STAKE}(id);
    }

    function _creatorTurn() private returns (uint256 id) {
        id = _open();
        _join(id);
        vm.prank(CHALLENGER);
        game.guess(id, 2);
    }

    function _awaitReveal() private returns (uint256 id) {
        id = _open();
        _join(id);
        vm.prank(CHALLENGER);
        game.concede(id);
    }

    function _round(uint80 round, bool down) private {
        feed.configure(round, down ? 1 : 0, block.timestamp, block.timestamp, round);
    }

    function testConstructorRequiresUsableHealthyFeed() public {
        vm.expectRevert(EtherMan.InvalidSequencerConfiguration.selector);
        new EtherMan(address(verifier), bytes32(uint256(1)), address(0));
        vm.expectRevert(EtherMan.InvalidSequencerConfiguration.selector);
        new EtherMan(address(verifier), bytes32(uint256(1)), OUTSIDER);
        _round(2, true);
        vm.expectRevert(EtherMan.InvalidSequencerConfiguration.selector);
        new EtherMan(address(verifier), bytes32(uint256(1)), address(feed));
        feed.malfunction(true, 160);
        vm.expectRevert(EtherMan.InvalidSequencerConfiguration.selector);
        new EtherMan(address(verifier), bytes32(uint256(1)), address(feed));
        feed.malfunction(false, 32);
        vm.expectRevert(EtherMan.InvalidSequencerConfiguration.selector);
        new EtherMan(address(verifier), bytes32(uint256(1)), address(feed));
        require(game.observedRoundId() == 1 && game.recoveryUntil() == 0, "constructor baseline");
    }

    function testDownFeedBlocksEveryRiskyActionAndPreservesFunds() public {
        uint256 open = _open();
        uint256 challengerTurn = _open();
        _join(challengerTurn);
        uint256 creatorTurn = _creatorTurn();
        uint256 revealTurn = _awaitReveal();
        uint256 next = game.nextGameId();
        uint256 escrow = game.totalEscrow();
        bytes32 unused = bytes32(uint256(99));
        _round(2, true);
        _status(EtherMan.NetworkStatus.Down);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.SequencerDown.selector);
        game.createGame{value: STAKE}(unused, 3, 3, new bytes(DictionaryConfig.PROOF_BYTES));
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.SequencerDown.selector);
        game.joinGame{value: STAKE}(open);
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.SequencerDown.selector);
        game.guess(challengerTurn, 2);
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.SequencerDown.selector);
        game.concede(challengerTurn);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.SequencerDown.selector);
        game.respond(creatorTurn, 2, 1);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.SequencerDown.selector);
        game.reveal(revealTurn, "cat", bytes32(revealTurn));
        vm.expectRevert(EtherMan.SequencerDown.selector);
        game.syncSequencer();
        vm.warp(block.timestamp + 30 days);
        for (uint256 id = challengerTurn; id <= revealTurn; ++id) {
            vm.expectRevert(EtherMan.SequencerDown.selector);
            game.claimTimeout(id);
        }
        require(game.nextGameId() == next && game.totalEscrow() == escrow, "failed actions atomic");
        require(!game.usedCommitments(unused), "failed creation consumes nothing");
        require(game.getGame(open).challenger == address(0), "failed join unchanged");
        _accounting();
    }

    function testUnavailableFeedCannotCreateJoinOrForfeit() public {
        uint256 open = _open();
        uint256 active = _creatorTurn();
        feed.malfunction(true, 160);
        _status(EtherMan.NetworkStatus.Unavailable);
        vm.prank(CREATOR);
        vm.expectRevert(EtherMan.SequencerUnavailable.selector);
        game.createGame{value: STAKE}(bytes32(uint256(100)), 3, 3, new bytes(DictionaryConfig.PROOF_BYTES));
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.SequencerUnavailable.selector);
        game.joinGame{value: STAKE}(open);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(EtherMan.SequencerUnavailable.selector);
        game.claimTimeout(active);
        vm.expectRevert(EtherMan.SequencerUnavailable.selector);
        game.syncSequencer();
        require(game.getGame(active).state == EtherMan.State.CreatorTurn, "active game readable");
        (uint8[] memory letters,) = game.getGuesses(active);
        require(letters.length == 0, "transcript readable");
        _accounting();
    }

    function testMalformedAndInvalidSnapshotsFailClosed() public {
        uint256[5][9] memory bad = [
            [uint256(0), 0, 1000, 1000, 0],
            [uint256(1) << 80, 0, 1000, 1000, uint256(1) << 80],
            [uint256(1), 2, 1000, 1000, 1],
            [uint256(1), type(uint256).max, 1000, 1000, 1],
            [uint256(1), 0, 0, 1000, 1],
            [uint256(1), 0, 1000, 0, 1],
            [uint256(1), 0, 1001, 1000, 1],
            [uint256(1), 0, 1000, 1001, 1],
            [uint256(1), 0, 1000, 1000, 2]
        ];
        for (uint256 i; i < bad.length; ++i) {
            feed.configure(bad[i][0], bad[i][1], bad[i][2], bad[i][3], bad[i][4]);
            _status(EtherMan.NetworkStatus.Unavailable);
            vm.expectRevert(EtherMan.SequencerUnavailable.selector);
            game.syncSequencer();
            vm.expectRevert(EtherMan.InvalidSequencerConfiguration.selector);
            new EtherMan(address(verifier), bytes32(uint256(1)), address(feed));
        }
        _round(1, false);
        for (uint256 length; length < 2; ++length) {
            feed.malfunction(false, length == 0 ? 128 : 161);
            _status(EtherMan.NetworkStatus.Unavailable);
            vm.expectRevert(EtherMan.SequencerUnavailable.selector);
            game.syncSequencer();
        }
    }

    function testRegressingRoundsFailClosedAfterRecovery() public {
        _round(3, false);
        game.syncSequencer();
        uint256 until = game.recoveryUntil();
        _round(2, false);
        _status(EtherMan.NetworkStatus.Unavailable);
        vm.expectRevert(EtherMan.SequencerUnavailable.selector);
        game.syncSequencer();
        require(game.observedRoundId() == 3 && game.recoveryUntil() == until, "checkpoint unchanged");
    }

    function testHealthyOldFeedDoesNotRequirePriceStyleFreshness() public {
        vm.warp(block.timestamp + 365 days);
        _status(EtherMan.NetworkStatus.Ready);
        game.syncSequencer();
        require(game.recoveryUntil() == 0, "no heartbeat grace");
        _open();
    }

    function testLateDeliveredRecoveryStartsFullGraceAtObservation() public {
        uint256 id = _creatorTurn();
        _round(2, true);
        vm.warp(block.timestamp + 30 days);
        // Recovery may have been reported on L1 long before its L2 delivery.
        feed.configure(3, 0, 2000, block.timestamp, 3);
        _status(EtherMan.NetworkStatus.RecoveryPending);
        uint256 observationTime = block.timestamp;
        vm.prank(OUTSIDER);
        game.syncSequencer();
        require(game.recoveryUntil() == observationTime + 1 days, "full observed grace");
        _status(EtherMan.NetworkStatus.Ready);
        vm.expectRevert(EtherMan.NotExpired.selector);
        game.claimTimeout(id);
        vm.prank(CREATOR);
        game.respond(id, 2, 1);
        require(game.getGame(id).state == EtherMan.State.ChallengerTurn, "play allowed in grace");
        _accounting();
    }

    function testMissedDownRoundStillTriggersRecoveryAndHeartbeatCannotExtend() public {
        uint256 id = _creatorTurn();
        vm.warp(block.timestamp + 3 days);
        _round(7, false); // Several complete outages can occur between calls.
        game.syncSequencer();
        uint256 until = game.recoveryUntil();
        vm.warp(until - 1);
        feed.configure(7, 0, 1000 + 3 days, block.timestamp, 7);
        game.syncSequencer();
        require(game.recoveryUntil() == until, "heartbeat cannot renew grace");
        vm.warp(until);
        vm.expectRevert(EtherMan.NotExpired.selector);
        game.claimTimeout(id);
        vm.warp(until + 1);
        game.claimTimeout(id);
        require(game.getGame(id).winner == CHALLENGER, "timeout eventually settles");
        _accounting();
    }

    function testTimeoutFirstCannotWinRaceAgainstUnrecordedRecovery() public {
        uint256 id = _creatorTurn();
        vm.warp(block.timestamp + 2 days);
        _round(3, false);
        vm.prank(OUTSIDER);
        vm.expectRevert(EtherMan.RecoverySyncRequired.selector);
        game.claimTimeout(id);
        require(game.observedRoundId() == 1 && game.recoveryUntil() == 0, "no reverted checkpoint");
        vm.prank(CREATOR);
        game.respond(id, 2, 1); // A legitimate action itself records the new round.
        require(game.observedRoundId() == 3, "automatic checkpoint");
        require(game.recoveryUntil() == block.timestamp + 1 days, "automatic grace");
        require(game.getGame(id).state == EtherMan.State.ChallengerTurn, "response succeeds");
        _accounting();
    }

    function testPlayerFirstRecordsRecoveryBeforeTimeout() public {
        uint256 id = _awaitReveal();
        vm.warp(block.timestamp + 2 days);
        _round(3, false);
        vm.prank(CREATOR);
        game.reveal(id, "cat", bytes32(id));
        vm.expectRevert(EtherMan.InvalidState.selector);
        game.claimTimeout(id);
        require(game.getGame(id).winner == CREATOR, "honest reveal wins before timeout");
        _accounting();
    }

    function testExactGraceBoundaryAllowsResponseThenNormalTurnDeadline() public {
        uint256 id = _creatorTurn();
        vm.warp(block.timestamp + 2 days);
        _round(3, false);
        game.syncSequencer();
        uint256 until = game.recoveryUntil();
        vm.warp(until);
        vm.expectRevert(EtherMan.NotExpired.selector);
        game.claimTimeout(id);
        vm.prank(CREATOR);
        game.respond(id, 2, 1);
        require(game.getGame(id).deadline == until + 1 days, "new turn gets full deadline");
        vm.warp(until + 1);
        vm.expectRevert(EtherMan.NotExpired.selector);
        game.claimTimeout(id);
    }

    function testRepeatedOutagesGiveOneNewGracePerRecoveryRound() public {
        uint256 id = _creatorTurn();
        vm.warp(block.timestamp + 2 days);
        _round(3, false);
        game.syncSequencer();
        uint256 first = game.recoveryUntil();
        vm.warp(first - 100);
        _round(4, true);
        vm.warp(first + 10 days);
        vm.expectRevert(EtherMan.SequencerDown.selector);
        game.claimTimeout(id);
        _round(5, false);
        vm.expectRevert(EtherMan.RecoverySyncRequired.selector);
        game.claimTimeout(id);
        game.syncSequencer();
        require(game.recoveryUntil() == block.timestamp + 1 days && game.recoveryUntil() > first, "second grace");
        vm.prank(CREATOR);
        game.respond(id, 2, 1);
        _accounting();
    }

    function testGraceProtectsChallengerAndRevealAndAlreadyExpiredTurns() public {
        uint256 challengerTurn = _open();
        _join(challengerTurn);
        uint256 revealTurn = _awaitReveal();
        vm.warp(block.timestamp + 10 days); // Deadlines already elapsed, but neither game settled.
        _round(3, false);
        game.syncSequencer();
        vm.expectRevert(EtherMan.NotExpired.selector);
        game.claimTimeout(challengerTurn);
        vm.expectRevert(EtherMan.NotExpired.selector);
        game.claimTimeout(revealTurn);
        vm.prank(CHALLENGER);
        game.guess(challengerTurn, 2);
        vm.prank(CREATOR);
        game.reveal(revealTurn, "cat", bytes32(revealTurn));
        require(game.getGame(revealTurn).winner == CREATOR, "reveal during grace");
        _accounting();
    }

    function testRecoveryNeverReopensTerminalGamesOrChangesOpenExpiry() public {
        uint256 settled = _awaitReveal();
        vm.prank(CREATOR);
        game.reveal(settled, "cat", bytes32(settled));
        uint256 cancelled = _open();
        vm.prank(CREATOR);
        game.cancelGame(cancelled);
        uint256 open = _open();
        uint256 rawDeadline = game.getGame(open).deadline;
        vm.warp(rawDeadline + 1);
        _round(3, false);
        game.syncSequencer();
        vm.prank(CHALLENGER);
        vm.expectRevert(EtherMan.Expired.selector);
        game.joinGame{value: STAKE}(open);
        require(game.getGame(open).deadline == rawDeadline, "open expiry unchanged");
        game.claimTimeout(open);
        vm.expectRevert(EtherMan.InvalidState.selector);
        game.claimTimeout(settled);
        vm.expectRevert(EtherMan.InvalidState.selector);
        game.claimTimeout(cancelled);
        require(game.getGame(settled).winner == CREATOR, "settlement unchanged");
        _accounting();
    }

    function testRefundsAndWithdrawalsBypassDownAndUnavailableFeeds() public {
        uint256 cancelled = _open();
        uint256 expired = _open();
        _round(2, true);
        vm.prank(CREATOR);
        game.cancelGame(cancelled);
        uint256 before = CREATOR.balance;
        vm.prank(CREATOR);
        game.withdrawTo(payable(CREATOR));
        require(CREATOR.balance == before + STAKE, "down feed withdrawal");
        feed.malfunction(true, 160);
        vm.warp(game.getGame(expired).deadline + 1);
        vm.prank(OUTSIDER);
        game.claimTimeout(expired);
        require(game.credits(CREATOR) == STAKE, "unavailable feed permissionless refund");
        vm.prank(CREATOR);
        game.withdrawTo(payable(CREATOR));
        require(game.totalCredits() == 0 && game.totalEscrow() == 0, "all funds recovered");
        _accounting();
    }

    function testInvalidPlayerActionCannotRecordRecoveryButSyncCan() public {
        uint256 id = _creatorTurn();
        vm.warp(block.timestamp + 2 days);
        _round(3, false);
        vm.prank(OUTSIDER);
        vm.expectRevert(EtherMan.Unauthorized.selector);
        game.respond(id, 2, 1);
        require(game.observedRoundId() == 1, "invalid action atomic");
        vm.prank(OUTSIDER);
        game.syncSequencer();
        require(game.observedRoundId() == 3, "anyone can checkpoint");
    }

    function testFuzzRecoveryDelayCannotConsumeGrace(uint32 elapsedSeed, uint32 lagSeed, uint8 roundSeed) public {
        uint256 id = _creatorTurn();
        uint256 elapsed = 2 days + uint256(elapsedSeed) % 365 days;
        vm.warp(block.timestamp + elapsed);
        uint80 recoveredRound = 3 + uint80(roundSeed) * 2;
        uint256 lag = uint256(lagSeed) % elapsed;
        feed.configure(recoveredRound, 0, block.timestamp - lag, block.timestamp, recoveredRound);
        uint256 observedAt = block.timestamp;
        game.syncSequencer();
        require(game.recoveryUntil() == observedAt + 1 days, "lag cannot consume grace");
        vm.warp(observedAt + 1 days);
        vm.expectRevert(EtherMan.NotExpired.selector);
        game.claimTimeout(id);
        vm.warp(observedAt + 1 days + 1);
        game.claimTimeout(id);
        require(game.getGame(id).winner == CHALLENGER, "bounded eventual timeout");
        _accounting();
    }

    function testLocalFeedCannotDeployOnPublicChainAndOnlyOwnerCanSimulate() public {
        vm.chainId(534352);
        vm.expectRevert(LocalSequencerFeed.LocalOnly.selector);
        new LocalSequencerFeed();
        vm.chainId(31337);
        LocalSequencerFeed local = new LocalSequencerFeed();
        vm.prank(OUTSIDER);
        vm.expectRevert(LocalSequencerFeed.Unauthorized.selector);
        local.setDown(true);
        local.setDown(true);
        (uint80 downRound, int256 down,,,) = local.latestRoundData();
        require(downRound == 2 && down == 1, "local down transition");
        vm.warp(block.timestamp + 100);
        local.setDown(false);
        (uint80 upRound, int256 up, uint256 started, uint256 updated,) = local.latestRoundData();
        require(upRound == 3 && up == 0 && started == updated, "local up transition");
        vm.warp(block.timestamp + 100);
        local.setDown(false);
        (uint80 heartbeat,, uint256 unchangedStart, uint256 heartbeatUpdate,) = local.latestRoundData();
        require(heartbeat == upRound && unchangedStart == started && heartbeatUpdate > updated, "same round heartbeat");
    }
}
