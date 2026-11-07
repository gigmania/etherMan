// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

interface IDictionaryVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @title EtherMan — interactive, committed-word Hangman escrow
/// @notice Local/testnet release candidate. A creator must answer turns and reveal
/// the committed word. Responses are provisional until the whole transcript is checked.
contract EtherMan {
    uint256 public constant DICTIONARY_PROOF_BYTES = 8768;
    uint256 private constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    address public immutable dictionaryVerifier;
    bytes32 public immutable dictionaryRoot;
    uint256 public constant TURN_TIMEOUT = 1 days;
    uint256 public constant OPEN_TIMEOUT = 7 days;
    uint256 public constant MAX_STAKE = 1 ether;
    uint8 public constant NO_LETTER = 26;

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
        uint16 revealedMask;
        uint8 pendingLetter;
        State state;
        address winner;
        string finalWord;
    }

    mapping(uint256 => Game) private games;
    mapping(uint256 => uint8[]) private responseLetters;
    mapping(uint256 => uint16[]) private responseMasks;
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

    event GameCreated(uint256 indexed gameId, address indexed creator, bytes32 commitment, uint256 stake, uint8 wordLength, uint8 maxMisses, uint256 deadline);
    event GameJoined(uint256 indexed gameId, address indexed challenger, uint256 deadline);
    event LetterGuessed(uint256 indexed gameId, address indexed challenger, uint8 letter, uint256 deadline);
    event LetterResponded(uint256 indexed gameId, address indexed creator, uint8 letter, uint16 mask, State state, uint256 deadline);
    event RevealRequested(uint256 indexed gameId, address indexed requester, uint256 deadline);
    event GameSettled(uint256 indexed gameId, address indexed winner, uint256 amount, string word);
    event GameCancelled(uint256 indexed gameId, address indexed creator, uint256 amount);
    event Withdrawn(address indexed account, address indexed recipient, uint256 amount);

    constructor(address verifier, bytes32 root) {
        if (verifier.code.length == 0 || uint256(root) == 0 || uint256(root) >= SNARK_SCALAR_FIELD) {
            revert InvalidDictionaryConfiguration();
        }
        dictionaryVerifier = verifier;
        dictionaryRoot = root;
    }

    /// @dev abi.encode, not packed encoding. The salt must be cryptographically random.
    function computeCommitment(address creator, string calldata word, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), creator, word, salt));
    }

    function createGame(bytes32 commitment, uint8 wordLength, uint8 maxMisses, bytes calldata dictionaryProof) external payable returns (uint256 gameId) {
        if (commitment == bytes32(0) || wordLength < 3 || wordLength > 12 || maxMisses == 0 || maxMisses > 8) revert InvalidInput();
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

    function respond(uint256 gameId, uint8 expectedLetter, uint16 mask) external {
        Game storage game = _game(gameId);
        _state(game, State.CreatorTurn);
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
        _beforeDeadline(game);
        if (msg.sender != game.challenger) revert Unauthorized();
        _requestReveal(gameId, game);
    }

    /// @notice Incorrect openings revert; a valid opening with a dishonest transcript loses.
    function reveal(uint256 gameId, string calldata word, bytes32 salt) external {
        Game storage game = _game(gameId);
        _state(game, State.AwaitReveal);
        _beforeDeadline(game);
        if (msg.sender != game.creator) revert Unauthorized();
        if (computeCommitment(game.creator, word, salt) != game.commitment) revert InvalidCommitment();
        bytes memory letters = bytes(word);
        bool canonical = _canonical(letters);
        bool honest = canonical && letters.length == game.wordLength;
        if (honest) {
            uint8[] storage guesses = responseLetters[gameId];
            uint16[] storage masks = responseMasks[gameId];
            for (uint256 i; i < guesses.length; ++i) {
                uint16 expected;
                for (uint256 j; j < letters.length; ++j) {
                    if (uint8(letters[j]) == guesses[i] + 97) expected |= uint16(uint256(1) << j);
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
        if (block.timestamp <= game.deadline) revert NotExpired();
        if (game.state == State.Open) {
            _cancel(gameId, game);
        } else if (game.state == State.ChallengerTurn) {
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
    function getGuesses(uint256 gameId) external view returns (uint8[] memory letters, uint16[] memory masks) {
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
        if (block.timestamp > game.deadline) revert Expired();
    }

    function _fullMask(uint8 length) private pure returns (uint16) {
        return (uint16(1) << length) - 1;
    }

    function _canonical(bytes memory word) private pure returns (bool) {
        if (word.length < 3 || word.length > 12) return false;
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
