// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {DictionaryConfig} from "./generated/DictionaryConfig.sol";

interface IDictionaryVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

interface ISequencerUptimeFeed {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// @title EtherMan — interactive, committed-word Hangman escrow
/// @notice Local/testnet release candidate. A creator must answer turns and reveal
/// the committed word. Responses are provisional until the whole transcript is checked.
contract EtherMan {
    uint256 public constant DICTIONARY_PROOF_BYTES = DictionaryConfig.PROOF_BYTES;
    uint256 private constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    address public immutable dictionaryVerifier;
    bytes32 public immutable dictionaryRoot;
    address public immutable sequencerUptimeFeed;
    uint80 public observedRoundId;
    uint256 public recoveryUntil;
    uint256 public constant RECOVERY_GRACE = 1 days;
    uint256 public constant TURN_TIMEOUT = 1 days;
    uint256 public constant OPEN_TIMEOUT = 7 days;
    uint256 public constant MAX_STAKE = 1 ether;
    uint8 public constant NO_LETTER = 26;

    enum NetworkStatus { Unavailable, Down, RecoveryPending, Ready }

    enum State { Open, ChallengerTurn, CreatorTurn, AwaitReveal, Settled, Cancelled }

    struct Game {
        address creator;
        address challenger;
        bytes32 commitment;
        uint256 stake;
        uint256 deadline;
        uint8 wordLength;
        uint8 maxMisses;
        uint8 misses;
        uint32 guessedLetters;
        uint32 revealedMask;
        uint8 pendingLetter;
        State state;
        address winner;
        string finalWord;
    }

    mapping(uint256 => Game) private games;
    mapping(uint256 => uint8[]) private responseLetters;
    mapping(uint256 => uint32[]) private responseMasks;
    mapping(address => uint256) public credits;
    mapping(bytes32 => bool) public usedCommitments;
    uint256 public nextGameId = 1;
    uint256 public totalEscrow;
    uint256 public totalCredits;
    bool private withdrawing;

    error UnknownGame();
    error InvalidInput();
    error InvalidStake();
    error InvalidState();
    error Unauthorized();
    error Expired();
    error NotExpired();
    error AlreadyGuessed();
    error InvalidCommitment();
    error NoCredit();
    error TransferFailed();
    error Reentrancy();
    error InvalidDictionaryConfiguration();
    error InvalidDictionaryProof();
    error CommitmentAlreadyUsed();
    error InvalidSequencerConfiguration();
    error SequencerUnavailable();
    error SequencerDown();
    error RecoverySyncRequired();

    event RecoveryGraceStarted(uint80 indexed roundId, uint256 recoveryUntil);

    event GameCreated(uint256 indexed gameId, address indexed creator, bytes32 commitment, uint256 stake, uint8 wordLength, uint8 maxMisses, uint256 deadline);
    event GameJoined(uint256 indexed gameId, address indexed challenger, uint256 deadline);
    event LetterGuessed(uint256 indexed gameId, address indexed challenger, uint8 letter, uint256 deadline);
    event LetterResponded(uint256 indexed gameId, address indexed creator, uint8 letter, uint32 mask, State state, uint256 deadline);
    event RevealRequested(uint256 indexed gameId, address indexed requester, uint256 deadline);
    event GameSettled(uint256 indexed gameId, address indexed winner, uint256 amount, string word);
    event GameCancelled(uint256 indexed gameId, address indexed creator, uint256 amount);
    event Withdrawn(address indexed account, address indexed recipient, uint256 amount);

    constructor(address verifier, bytes32 root, address uptimeFeed) {
        if (verifier.code.length == 0 || uint256(root) == 0 || uint256(root) >= SNARK_SCALAR_FIELD) {
            revert InvalidDictionaryConfiguration();
        }
        dictionaryVerifier = verifier;
        dictionaryRoot = root;
        if (uptimeFeed.code.length == 0) revert InvalidSequencerConfiguration();
        sequencerUptimeFeed = uptimeFeed;
        (bool valid, bool down, uint80 roundId) = _sequencerSnapshot();
        if (!valid || down) revert InvalidSequencerConfiguration();
        observedRoundId = roundId;
    }

    /// @notice Reports feed availability and whether a new healthy round needs recording.
    /// @dev Heartbeats can refresh feed timestamps without changing its round. They
    /// must not renew grace, and an old healthy timestamp is not a stale-price test.
    function getNetworkStatus() public view returns (NetworkStatus status, uint80 roundId, uint256 graceUntil) {
        (bool valid, bool down, uint80 currentRound) = _sequencerSnapshot();
        graceUntil = recoveryUntil;
        if (!valid) return (NetworkStatus.Unavailable, 0, graceUntil);
        roundId = currentRound;
        if (down) return (NetworkStatus.Down, roundId, graceUntil);
        status = roundId > observedRoundId ? NetworkStatus.RecoveryPending : NetworkStatus.Ready;
    }

    /// @notice Anyone may record recovery. The grace period starts when this
    /// contract observes a new healthy round, not at a potentially delayed L1 timestamp.
    function syncSequencer() external {
        _syncSequencer();
    }

    /// @dev abi.encode, not packed encoding. The salt must be cryptographically random.
    function computeCommitment(address creator, string calldata word, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), creator, word, salt));
    }

    function createGame(bytes32 commitment, uint8 wordLength, uint8 maxMisses, bytes calldata dictionaryProof) external payable returns (uint256 gameId) {
        _syncSequencer();
        if (commitment == bytes32(0) || wordLength == 0 || wordLength > DictionaryConfig.MAX_WORD_LENGTH || maxMisses == 0 || maxMisses > 8) revert InvalidInput();
        if (msg.value == 0 || msg.value > MAX_STAKE) revert InvalidStake();
        if (usedCommitments[commitment]) revert CommitmentAlreadyUsed();
        if (dictionaryProof.length != DICTIONARY_PROOF_BYTES) revert InvalidDictionaryProof();
        // Construct all public inputs here. A caller cannot select another root,
        // creator, contract, or chain. Full-width values use two 128-bit limbs.
        bytes32[] memory publicInputs = new bytes32[](8);
        publicInputs[0] = dictionaryRoot;
        publicInputs[1] = bytes32(block.chainid >> 128);
        publicInputs[2] = bytes32(uint256(uint128(block.chainid)));
        publicInputs[3] = bytes32(uint256(uint160(address(this))));
        publicInputs[4] = bytes32(uint256(uint160(msg.sender)));
        publicInputs[5] = bytes32(uint256(wordLength));
        publicInputs[6] = bytes32(uint256(commitment) >> 128);
        publicInputs[7] = bytes32(uint256(uint128(uint256(commitment))));
        // The view interface uses STATICCALL. A revert, malformed return, or
        // rejected proof cannot consume a commitment or change escrow.
        try IDictionaryVerifier(dictionaryVerifier).verify(dictionaryProof, publicInputs) returns (bool valid) {
            if (!valid) revert InvalidDictionaryProof();
        } catch {
            revert InvalidDictionaryProof();
        }
        usedCommitments[commitment] = true;
        gameId = nextGameId++;
        Game storage game = games[gameId];
        game.creator = msg.sender;
        game.commitment = commitment;
        game.stake = msg.value;
        game.deadline = block.timestamp + OPEN_TIMEOUT;
        game.wordLength = wordLength;
        game.maxMisses = maxMisses;
        game.pendingLetter = NO_LETTER;
        totalEscrow += msg.value;
        emit GameCreated(gameId, msg.sender, commitment, msg.value, wordLength, maxMisses, game.deadline);
    }

    function joinGame(uint256 gameId) external payable {
        Game storage game = _game(gameId);
        _state(game, State.Open);
        _syncSequencer();
        _beforeDeadline(game);
        if (msg.sender == game.creator) revert Unauthorized();
        if (msg.value != game.stake) revert InvalidStake();
        game.challenger = msg.sender;
        game.state = State.ChallengerTurn;
        game.deadline = block.timestamp + TURN_TIMEOUT;
        totalEscrow += msg.value;
        emit GameJoined(gameId, msg.sender, game.deadline);
    }

    function guess(uint256 gameId, uint8 letter) external {
        Game storage game = _game(gameId);
        _state(game, State.ChallengerTurn);
        _syncSequencer();
        _beforeDeadline(game);
        if (msg.sender != game.challenger) revert Unauthorized();
        if (letter >= 26) revert InvalidInput();
        uint32 bit = uint32(1) << letter;
        if (game.guessedLetters & bit != 0) revert AlreadyGuessed();
        game.guessedLetters |= bit;
        game.pendingLetter = letter;
        game.state = State.CreatorTurn;
        game.deadline = block.timestamp + TURN_TIMEOUT;
        emit LetterGuessed(gameId, msg.sender, letter, game.deadline);
    }

    function respond(uint256 gameId, uint8 expectedLetter, uint32 mask) external {
        Game storage game = _game(gameId);
        _state(game, State.CreatorTurn);
        _syncSequencer();
        _beforeDeadline(game);
        if (msg.sender != game.creator) revert Unauthorized();
        if (expectedLetter != game.pendingLetter) revert InvalidInput();
        if (mask > _fullMask(game.wordLength) || mask & game.revealedMask != 0) revert InvalidInput();
        uint8 letter = game.pendingLetter;
        responseLetters[gameId].push(letter);
        responseMasks[gameId].push(mask);
        game.pendingLetter = NO_LETTER;
        game.revealedMask |= mask;
        if (mask == 0) game.misses++;
        game.state = game.revealedMask == _fullMask(game.wordLength) || game.misses == game.maxMisses
            ? State.AwaitReveal : State.ChallengerTurn;
        game.deadline = block.timestamp + TURN_TIMEOUT;
        emit LetterResponded(gameId, msg.sender, letter, mask, game.state, game.deadline);
    }

    /// @notice End guessing, requiring the creator to prove all prior answers before winning.
    function concede(uint256 gameId) external {
        Game storage game = _game(gameId);
        _state(game, State.ChallengerTurn);
        _syncSequencer();
        _beforeDeadline(game);
        if (msg.sender != game.challenger) revert Unauthorized();
        _requestReveal(gameId, game);
    }

    /// @notice Incorrect openings revert; a valid opening with a dishonest transcript loses.
    function reveal(uint256 gameId, string calldata word, bytes32 salt) external {
        Game storage game = _game(gameId);
        _state(game, State.AwaitReveal);
        _syncSequencer();
        _beforeDeadline(game);
        if (msg.sender != game.creator) revert Unauthorized();
        if (computeCommitment(game.creator, word, salt) != game.commitment) revert InvalidCommitment();
        bytes memory letters = bytes(word);
        bool canonical = _canonical(letters);
        bool honest = canonical && letters.length == game.wordLength;
        if (honest) {
            uint8[] storage guesses = responseLetters[gameId];
            uint32[] storage masks = responseMasks[gameId];
            for (uint256 i; i < guesses.length; ++i) {
                uint32 expected;
                for (uint256 j; j < letters.length; ++j) {
                    if (uint8(letters[j]) == guesses[i] + 97) expected |= uint32(uint256(1) << j);
                }
                if (expected != masks[i]) {
                    honest = false;
                    break;
                }
            }
        }
        // Never store an unbounded/invalid string, even if its commitment is valid.
        if (canonical) game.finalWord = word;
        address winner = honest && game.revealedMask != _fullMask(game.wordLength) ? game.creator : game.challenger;
        _settle(gameId, game, winner);
    }

    function cancelGame(uint256 gameId) external {
        Game storage game = _game(gameId);
        _state(game, State.Open);
        if (msg.sender != game.creator) revert Unauthorized();
        _cancel(gameId, game);
    }

    /// @notice Permissionless progress after a deadline; callers never receive a bounty.
    function claimTimeout(uint256 gameId) external {
        Game storage game = _game(gameId);
        if (game.state == State.Settled || game.state == State.Cancelled) revert InvalidState();
        // An unmatched deposit can always be refunded after its ordinary expiry.
        if (game.state == State.Open) {
            if (block.timestamp <= game.deadline) revert NotExpired();
            _cancel(gameId, game);
            return;
        }
        (NetworkStatus status,,) = getNetworkStatus();
        _requireAvailable(status);
        // Do not update the checkpoint then revert NotExpired, which would roll
        // back its timestamp. A player action or syncSequencer records recovery.
        if (status == NetworkStatus.RecoveryPending) revert RecoverySyncRequired();
        if (block.timestamp <= _effectiveDeadline(game)) revert NotExpired();
        if (game.state == State.ChallengerTurn) {
            // A lying creator must not win simply because a challenger went offline.
            _requestReveal(gameId, game);
        } else {
            _settle(gameId, game, game.challenger);
        }
    }

    /// @notice Withdraw only your credit, optionally to a different receiving address.
    function withdrawTo(address payable recipient) external {
        if (withdrawing) revert Reentrancy();
        if (recipient == address(0) || recipient == address(this)) revert InvalidInput();
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NoCredit();
        withdrawing = true;
        credits[msg.sender] = 0;
        totalCredits -= amount;
        (bool success,) = recipient.call{value: amount}("");
        if (!success) revert TransferFailed();
        withdrawing = false;
        emit Withdrawn(msg.sender, recipient, amount);
    }

    function getGame(uint256 gameId) external view returns (Game memory) {
        return _game(gameId);
    }

    /// @return letters Completed response letters, numbered a=0 through z=25.
    /// @return masks Corresponding position masks; bit 0 is the first word character.
    function getGuesses(uint256 gameId) external view returns (uint8[] memory letters, uint32[] memory masks) {
        _game(gameId);
        return (responseLetters[gameId], responseMasks[gameId]);
    }

    function _game(uint256 gameId) private view returns (Game storage game) {
        game = games[gameId];
        if (game.creator == address(0)) revert UnknownGame();
    }

    function _state(Game storage game, State expected) private view {
        if (game.state != expected) revert InvalidState();
    }

    function _beforeDeadline(Game storage game) private view {
        if (block.timestamp > _effectiveDeadline(game)) revert Expired();
    }

    function _effectiveDeadline(Game storage game) private view returns (uint256) {
        if (game.state != State.Open && game.state < State.Settled && recoveryUntil > game.deadline) {
            return recoveryUntil;
        }
        return game.deadline;
    }

    function _requireAvailable(NetworkStatus status) private pure {
        if (status == NetworkStatus.Unavailable) revert SequencerUnavailable();
        if (status == NetworkStatus.Down) revert SequencerDown();
    }

    function _syncSequencer() private {
        (NetworkStatus status, uint80 roundId,) = getNetworkStatus();
        _requireAvailable(status);
        if (status == NetworkStatus.RecoveryPending) {
            observedRoundId = roundId;
            recoveryUntil = block.timestamp + RECOVERY_GRACE;
            emit RecoveryGraceStarted(roundId, recoveryUntil);
        }
    }

    function _sequencerSnapshot() private view returns (bool valid, bool down, uint80 roundId) {
        (bool success, bytes memory result) = sequencerUptimeFeed.staticcall(
            abi.encodeCall(ISequencerUptimeFeed.latestRoundData, ())
        );
        if (!success || result.length != 160) return (false, false, 0);
        // Decode full words before checking narrowed ABI fields. This makes
        // malformed uint80/int256 answers fail closed instead of reverting a view.
        (uint256 round, uint256 answer, uint256 startedAt, uint256 updatedAt, uint256 answeredInRound) =
            abi.decode(result, (uint256, uint256, uint256, uint256, uint256));
        if (
            round == 0 || round > type(uint80).max || round < observedRoundId || answer > 1 ||
            startedAt == 0 || updatedAt == 0 || startedAt > updatedAt || updatedAt > block.timestamp ||
            answeredInRound != round
        ) return (false, false, 0);
        return (true, answer == 1, uint80(round));
    }

    function _fullMask(uint8 length) private pure returns (uint32) {
        return (uint32(1) << length) - 1;
    }

    function _canonical(bytes memory word) private pure returns (bool) {
        if (word.length == 0 || word.length > DictionaryConfig.MAX_WORD_LENGTH) return false;
        for (uint256 i; i < word.length; ++i) {
            if (uint8(word[i]) < 97 || uint8(word[i]) > 122) return false;
        }
        return true;
    }

    function _requestReveal(uint256 gameId, Game storage game) private {
        game.state = State.AwaitReveal;
        game.deadline = block.timestamp + TURN_TIMEOUT;
        emit RevealRequested(gameId, msg.sender, game.deadline);
    }

    function _settle(uint256 gameId, Game storage game, address winner) private {
        game.state = State.Settled;
        game.winner = winner;
        game.pendingLetter = NO_LETTER;
        uint256 amount = game.stake * 2;
        totalEscrow -= amount;
        totalCredits += amount;
        credits[winner] += amount;
        emit GameSettled(gameId, winner, amount, game.finalWord);
    }

    function _cancel(uint256 gameId, Game storage game) private {
        game.state = State.Cancelled;
        totalEscrow -= game.stake;
        totalCredits += game.stake;
        credits[game.creator] += game.stake;
        emit GameCancelled(gameId, game.creator, game.stake);
    }
}
