# Security model and limits

## Assets and trust boundaries

The contract holds each open creator stake, each joined two-player pot, and claimable withdrawal credits. The creator's word and high-entropy salt are secret until reveal. Wallet accounts, chain selection, RPC results, recovery files, contract inputs and other participants are untrusted boundaries.

The browser creates the commitment using ABI encoding of chain ID, contract address, creator address, word and a cryptographically random 32-byte salt. The contract exposes the same computation for interoperability. The word and salt must not enter creation calldata, logs, URLs or browser persistent storage. A user-exported recovery file intentionally contains both and must remain private. Browser compromise or sharing the file defeats answer secrecy.

The creator knows the answer and supplies provisional per-letter masks. Settlement checks the committed word and the entire bounded transcript. A zero-knowledge dictionary proof gates creation; it does not validate each response immediately or remove the need for participant interaction. The dictionary root and declared word length are public and narrow the possible vocabulary. The proof keeps the membership path, word, and salt private until the final opening. Participants must still monitor deadlines and submit transactions.

The fixed deployment's verifier, linked libraries, dictionary root, circuit, compiler, proving backend, and proving parameters are additional trust boundaries. The candidate uses Noir 1.0.0 and Barretenberg 6.0.0 with its zero-knowledge EVM target. Backend/CRS provenance and cryptographic assumptions need independent review; a generated verifier and passing tests are not an external audit. Constructor checks only establish that verifier code exists and the root is a nonzero canonical field element. They do not establish that arbitrary supplied code implements the approved proof system.

## Controls

- Creation requires an 8,768-byte dictionary proof. The contract derives the root, chain, contract, creator, length, and full commitment inputs itself; callers cannot supply a different public-input array. High/low 128-bit limbs preserve full-width values.
- The verifier/root are immutable and verification uses `STATICCALL`. Failed verification leaves game IDs, escrow, credits, and commitment consumption unchanged. No external word oracle or public membership path is involved.
- Commitments are consumed permanently only after successful verification. Cancellation and settlement do not permit reuse; a new random salt allows the same word in a later game.
- Caller authorization is enforced on-chain for joins, guesses, responses, concessions, reveals, cancellations and withdrawals.
- Game IDs only increase; game terms are immutable. Existing IDs cannot be recycled under pending transactions.
- Both stakes must match exactly. Per-game escrow only moves into credits once, at a terminal transition.
- The accounting invariant is `totalEscrow + totalCredits <= contract balance`; forced ETH can make the inequality strict. There is no surplus sweeping function.
- State changes and credit debits precede external withdrawal calls. Reentrancy is guarded; failed transfers revert and restore the credit. A claimant can choose a different recipient.
- No creator-winning timeout bypasses reveal validation. Missing a creator response or reveal loses the pot; challenger inactivity opens a reveal window.
- Inputs, words, misses, masks and transcript lengths are bounded. Read APIs are game-specific; the frontend loads bounded pages.
- UI writes require a permitted chain, account, deployed contract code, successful simulation, wallet approval and a successful receipt. Mainnet is not a permitted UI chain in this candidate.

## Known limits and economic assumptions

- The fixed vocabulary contains 274,137 ASCII lowercase words (currently 2–28 letters) from `word-list@4.1.0` (MIT package, CC0-1.0 Letterpress source). Exact provenance and notices are in `dictionary/`. Obscure/regional words and inflections may be included; membership is not a claim of universal English validity, suitable difficulty, comprehensive moderation, or fair random word distribution.
- There is no dictionary or verifier administrator. Any vocabulary/circuit/verifier update requires a new deployment and explicit adoption. Existing recovery files remain version 1 because the salted Keccak encoding is unchanged; old games still need access to their original contract.
- Every action is a transaction. Gas, censorship, network congestion and missed deadlines can affect outcomes. The contract has no autonomous scheduler; someone must claim an elapsed timeout. The current 24-hour turn deadline does not pause during a Scroll sequencer outage. An outage-safe design remains a launch blocker.
- The complete generated verifier measured approximately 3.84 million gas on local Anvil. This is not the full creation cost, a Scroll fee quote, or proof of Scroll-native compatibility. Browser proving performance, native execution, and complete-game L2/data fees remain release evidence requirements.
- A salted commitment hides the answer only if the salt is fresh and secret. Reusing a revealed word/salt pair can expose future games.
- There is no protocol fee or administrator. The original implicit 3% deduction was not retained because it lacked defined ownership/withdrawal rules. Any future fee or privilege requires an explicit design and review.
- Withdrawal credits have no expiry. Lost account keys cannot be recovered by an administrator. Lost answer recovery material can cause the creator to forfeit.
- The 1 ETH cap is per creator stake, not a global exposure cap. It is not a substitute for audit or a release risk limit.
- There is no migration or upgrade path from the legacy contracts. Their old arbitrary-payout vulnerability must not be used as a migration mechanism.
- The legacy folder contains known-vulnerable inactive code and an old lockfile. Root audits and new tests describe the active application only. Do not deploy or install the archived project.

## Evidence and independent review

Unit, fuzz, invariant, real-chain integration and browser tests cover different failure paths. Fast Foundry tests use mock verifiers for game-state and boundary behavior; they do not establish dictionary-proof soundness. Real-proof acceptance/rejection tests must use the exact generated verifier and include tampered public inputs, invalid witnesses, copied proofs, and replay. Passing these checks is not a security certification. The release candidate still requires independent external contract/circuit review, deployment-artifact and proving-parameter provenance, a live-deployment inventory, native Scroll execution and fee measurements, and rehearsal before mainnet approval. Review findings and executed checks are recorded in `docs/verification.md` as work completes.
