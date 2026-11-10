# EtherMan v2 protocol

This is a local/testnet release candidate, not an audited or approved mainnet release.
The v1 contracts and artifacts are historical source, not part of the v2 build.

## Rules and trust assumptions

Two players escrow the same positive ETH stake, at most 1 ETH per player. The
creator chooses a lowercase ASCII word from the fixed game dictionary
and 1–8 allowed misses. A private dictionary-membership proof is required when
creating the game. Guesses are single letters, each used at most once.
The creator must answer every turn and ultimately reveal the word and its random
32-byte salt. A successful letter does not count as a miss. There is no protocol
fee, administrator, upgrade mechanism, or owner withdrawal. The v1 implicit 3%
deduction is not carried forward; economics must be reviewed before release.

The commitment is `keccak256(abi.encode(chainId, contractAddress, creator, word,
salt))`. Use a fresh cryptographically random salt for every game. The word and
salt must remain off-chain until the reveal transaction; losing them can lose the
creator's stake. A commitment hides the word only to the extent that the salt is
unpredictable and kept secret. Do not reuse a salt/commitment. Contract, chain, and
creator separation prevents a different creator from copying an opening. The
contract permanently rejects reuse of a commitment, including after cancellation
or settlement. A fresh salt permits another game using the same word. The
commitment encoding and version-1 recovery-file format remain unchanged.

The creator reports a 16-bit mask for each guess: bit 0 is the first character,
bit 1 the second, and so on. All occurrences must be included, and zero means a
miss. Answers are **provisional**. Every recorded answer is replayed against the
revealed word before the creator can win. Omitted or fabricated occurrences award
the entire pot to the challenger. Canonical-word and declared-length checks remain
in reveal as defense in depth, although the creation proof already establishes
those properties for the approved verifier. A wrong word/salt opening reverts and can be retried until expiry.

The dictionary proof validates creation only. Per-letter responses still use
economic enforcement and final transcript replay rather than immediate proof
verification or automatic feedback. Both players must monitor their turns. Each
action requires a transaction and incurs gas. A creator can choose an unfamiliar
or repeated-letter dictionary word; membership does not certify difficulty or
provide a fair random word distribution.

## Private dictionary membership

The initial vocabulary contains 274,137 words, normalized from `word-list@4.1.0`
to all unique ASCII lowercase entries, without a length filter, sorted in ASCII order. The
package carries MIT terms and its Letterpress source carries CC0-1.0 terms;
source identities, normalization rules, hashes, and notices are retained in
[`dictionary/`](../dictionary/README.md). Membership means inclusion in this exact
vocabulary, not a universal judgment of English validity. Regional spellings and
obscure inflections may appear, and names or newer terms may be absent.

A depth-19 Poseidon2 Merkle tree commits to the vocabulary. The leaf is
`H(1, length, packedWord224)` and an internal node is `H(2, left, right)`. The packed
word contains its ASCII bytes followed by zero padding to twenty-eight bytes. Empty
leaves use `H(1, 0, 0)` and cannot satisfy the circuit's valid-word constraints.
The generated tree manifest records the exact root and binary layout.

The circuit uses Noir 1.0.0 and Barretenberg 6.0.0 with the zero-knowledge EVM
verifier target (`evm`, never `evm-no-zk`). It establishes dictionary membership,
word length/canonical padding, and the unchanged Keccak commitment. The word,
salt, membership siblings, and path directions are private witness inputs. The
public inputs, in order, are root, chain ID high/low 128-bit limbs, game-contract
address, creator address, length, and commitment high/low 128-bit limbs. Full
256-bit values are split rather than reduced modulo the proof field. No external
word oracle or public membership path is used.

`EtherMan` fixes the verifier address and dictionary root in its constructor.
Creation derives all eight public inputs on-chain and verifies the 8,768-byte
proof through a static call. Rejected, reverting, or malformed verification cannot
create a game, retain the stake, or consume the commitment. Deployment must use
the reviewed verifier and root; constructor validation is not a substitute for
checking artifact identity. There is no administrator or dictionary setter.
Changing the vocabulary, proof circuit, or verifier requires a new deployment.

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

An action is permitted at `block.timestamp == effectiveDeadline`. Expiry is
permitted only at `block.timestamp > effectiveDeadline`. Each turn and reveal request gets a new 24-hour
deadline. Missing a deadline can forfeit the pot; no automatic transaction executor
is provided. Permissionless timeout callers never receive funds or a bounty.
For active states 1–3, the effective deadline is the later of the stored turn
end and global recovery grace. The fixed uptime feed must be healthy. A new
healthy round requires permissionless synchronization before active timeout
claims; synchronization starts 24 hours of grace from local observation. Ordinary
player actions can synchronize automatically and remain available during grace.
Same-round heartbeats never extend it. All unsettled active games receive grace,
even if a prior deadline passed without settlement. Open expiry/refunds and
withdrawals remain independent of the feed. See [outage rules and external trust
limits](outage-handling.md); unreported outages and censorship are not covered.

## API

`constructor(address verifier, bytes32 root, address uptimeFeed)` requires deployed
verifier code, a nonzero root below the BN254 scalar-field modulus, and a valid
healthy initial uptime round. All three configuration values are immutable.

`createGame(bytes32 commitment, uint8 wordLength, uint8 maxMisses, bytes dictionaryProof)`
is payable and returns a new ID after proof verification. There is no unverified
creation overload. IDs start at 1 and are never reused. `nextGameId` is the next
unused ID. Terms of a created game are immutable.

- `dictionaryVerifier()` and `dictionaryRoot()` expose the immutable proof policy.
- `sequencerUptimeFeed()`, `observedRoundId()`, and `recoveryUntil()` expose the outage configuration/checkpoint.
- `getNetworkStatus()` returns Unavailable (0), Down (1), RecoveryPending (2), or Ready (3), with the observed feed round and stored grace deadline. Ready includes ongoing grace.
- `syncSequencer()` records a new healthy round and starts grace once.
- `getGame().deadline` remains the raw deadline; clients must apply the active-game recovery maximum and health gates.
- `usedCommitments(bytes32 commitment)` records permanent consumption.
- `DICTIONARY_PROOF_BYTES()` is 8,768 for the pinned verifier format.

- `joinGame(uint256 gameId)` payable, exact stake required.
- `guess(uint256 gameId, uint8 letter)` uses a=0 through z=25.
- `respond(uint256 gameId, uint8 expectedLetter, uint32 mask)` submits the creator's
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
  `uint8[] letters` and `uint32[] masks`. The unanswered guess is in `pendingLetter`.

`Game` fields in order: `address creator`, `address challenger`, `bytes32
commitment`, `uint256 stake`, `uint256 deadline`, `uint8 wordLength`, `uint8
maxMisses`, `uint8 misses`, `uint32 guessedLetters`, `uint32 revealedMask`, `uint8
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
pooled-fund isolation, fuzzed masks, and stateful accounting invariants. Fast
Foundry game-state and verifier-boundary tests use a mock verifier and do not
establish cryptographic validity. Separate real-proof tests must exercise the
generated Solidity verifier, including altered public inputs and malformed proofs.
Passing tests do not substitute for external cryptographic/security review and
Scroll-native rehearsal.

The complete generated verifier used approximately 3.84 million gas in a local
Anvil measurement. That excludes the remaining game-creation work and is not a
Scroll transaction fee or full-game cost. Native execution, proving compatibility,
L2 execution fees, and Ethereum data fees require separate validation.

Before mainnet: review word/game rules and fee economics, measure gas for the
complete two-player lifecycle, independently audit contracts and secret handling,
verify compiler/build provenance, rehearse deadline and recovery UX, determine
whether legacy funds exist, and approve a concrete deployment/migration plan.

## Vocabulary v2 compatibility

The build derives circuit/tree capacity from the pinned full vocabulary (currently
2–28 letters). Creation has no HTML length cap; membership decides eligibility.
The encoding builder fails explicitly above 31 bytes, where the packed-field and
32-bit-mask design would need revision, rather than silently dropping words.

Position masks are now uint32. The `respond` and response-event signatures change
from v1, so a fresh contract and its matching ABI/UI are required. Existing games
stay on their old contracts and must use the previous UI/ABI (commit `23f32a3` for
dictionary v1). Keccak commitments and recovery-file version 1 are unchanged.
