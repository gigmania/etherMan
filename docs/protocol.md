# EtherMan v2 protocol

This is a local/testnet release candidate, not an audited or approved mainnet release.
The v1 contracts and artifacts are historical source, not part of the v2 build.

## Rules and trust assumptions

Two players escrow the same positive ETH stake, at most 1 ETH per player. The
creator chooses 3–12 lowercase ASCII letters and 1–8 allowed misses. There is no
dictionary restriction. Guesses are single letters, each used at most once.
The creator must answer every turn and ultimately reveal the word and its random
32-byte salt. A successful letter does not count as a miss. There is no protocol
fee, administrator, upgrade mechanism, or owner withdrawal. The v1 implicit 3%
deduction is not carried forward; economics must be reviewed before release.

The commitment is `keccak256(abi.encode(chainId, contractAddress, creator, word,
salt))`. Use a fresh cryptographically random salt for every game. The word and
salt must remain off-chain until the reveal transaction; losing them can lose the
creator's stake. A commitment hides the word only to the extent that the salt is
unpredictable and kept secret. Do not reuse a salt/commitment. Contract, chain, and
creator separation prevents a different creator from copying an opening.

The creator reports a 16-bit mask for each guess: bit 0 is the first character,
bit 1 the second, and so on. All occurrences must be included, and zero means a
miss. Answers are **provisional**. Every recorded answer is replayed against the
revealed word before the creator can win. Invalid committed words, wrong declared
lengths, omitted occurrences, and fabricated occurrences award the entire pot to
the challenger. A wrong word/salt opening reverts and can be retried until expiry.

The scheme provides economic enforcement of truthful responses, not instant
cryptographic verification or automatic feedback. Both players must monitor their
turns. Each action requires a transaction and incurs gas. A creator can choose an
unfamiliar or repeated-letter string; the contract does not certify word quality.

## States and deadlines

| Value | State | Allowed progress |
| --- | --- | --- |
| 0 | Open | Creator cancels; different challenger joins with exact stake; anyone expires after 7 days. |
| 1 | ChallengerTurn | Challenger guesses an unused letter or concedes. After 24 hours, anyone requests reveal. |
| 2 | CreatorTurn | Creator responds. After 24 hours, anyone settles to challenger. |
| 3 | AwaitReveal | Creator reveals. After 24 hours, anyone settles to challenger. |
| 4 | Settled | Terminal; winner has withdrawal credit. |
| 5 | Cancelled | Terminal; creator has refund credit. |

A response enters AwaitReveal if all positions are shown or maximum misses are
reached; otherwise it returns to ChallengerTurn. Conceding or a challenger timeout
also enters AwaitReveal. Critically, neither can directly pay the creator: even
after challenger inactivity, prior responses must pass replay validation. With an
honest transcript, all positions shown awards the challenger; any other completed
reason awards the creator. Creator response/reveal timeouts award the challenger.

An action is permitted at `block.timestamp == deadline`. Expiry is permitted only
at `block.timestamp > deadline`. Each turn and reveal request gets a new 24-hour
deadline. Missing a deadline can forfeit the pot; no automatic transaction executor
is provided. Permissionless timeout callers never receive funds or a bounty.

## API

`createGame(bytes32 commitment, uint8 wordLength, uint8 maxMisses)` is payable and
returns a new ID. IDs start at 1 and are never reused. `nextGameId` is the next
unused ID. Terms of a created game are immutable.

- `joinGame(uint256 gameId)` payable, exact stake required.
- `guess(uint256 gameId, uint8 letter)` uses a=0 through z=25.
- `respond(uint256 gameId, uint8 expectedLetter, uint16 mask)` submits the creator's
  answer for that letter (a=0 through z=25). The expected letter must match the
  current unanswered guess. A delayed or retried response cannot apply to a later
  turn, even if the previous and current responses both have a zero mask.
- `concede(uint256 gameId)` is challenger-only during ChallengerTurn.
- `reveal(uint256 gameId, string word, bytes32 salt)` is creator-only in AwaitReveal.
- `cancelGame(uint256 gameId)` is creator-only while Open, including after expiry.
- `claimTimeout(uint256 gameId)` advances an expired nonterminal game.
- `withdrawTo(address payable recipient)` withdraws all of the caller's credit.
- `computeCommitment(address creator, string word, bytes32 salt)` computes the
  commitment for this chain and contract.
- `getGame(uint256 gameId)` returns the `Game` struct, reverting for nonexistent IDs.
- `getGuesses(uint256 gameId)` returns parallel arrays of **completed responses**:
  `uint8[] letters` and `uint16[] masks`. The unanswered guess is in `pendingLetter`.

`Game` fields in order: `address creator`, `address challenger`, `bytes32
commitment`, `uint256 stake`, `uint256 deadline`, `uint8 wordLength`, `uint8
maxMisses`, `uint8 misses`, `uint32 guessedLetters`, `uint16 revealedMask`, `uint8
pendingLetter`, `State state`, `address winner`, `string finalWord`.
`pendingLetter=26` means none. `guessedLetters` is a letter bitset. `revealedMask`
is the union of response masks. `finalWord` is populated only after a matching
opening with canonical characters; timeout settlements may leave it empty.

Every game event identifies its game ID. `Withdrawn` identifies account/recipient
because it may aggregate credits from several games. Reads are per-game and
transcripts are bounded to 26 responses; the client must paginate its game IDs.

## Accounting and verification

Game actions never push ETH to players. Open refunds and settled pots become
`credits[account]`. Withdrawals debit credit before transferring, are reentrancy
guarded, and revert without losing the credit if the recipient rejects ETH. A
contract wallet may select a different recipient. Zero and self recipients are
rejected. `totalEscrow + totalCredits <= address(this).balance` must always hold;
forced ETH can make the inequality strict and has no privileged recovery path.

The Foundry suite uses the pinned Solidity 0.8.38 compiler, Cancun EVM, and optimizer
with 200 runs. Tests cover authorization, exact deposits, turn deadlines, all
settlement paths, malformed openings/transcripts, withdrawal failure/reentrancy,
pooled-fund isolation, fuzzed masks, and stateful accounting invariants. Passing
tests do not substitute for independent security review and testnet rehearsal.

Before mainnet: review word/game rules and fee economics, measure gas for the
complete two-player lifecycle, independently audit contracts and secret handling,
verify compiler/build provenance, rehearse deadline and recovery UX, determine
whether legacy funds exist, and approve a concrete deployment/migration plan.
