# Security model and limits

## Assets and trust boundaries

The contract holds each open creator stake, each joined two-player pot, and claimable withdrawal credits. The creator's word and high-entropy salt are secret until reveal. Wallet accounts, chain selection, RPC results, recovery files, contract inputs and other participants are untrusted boundaries.

The browser creates the commitment using ABI encoding of chain ID, contract address, creator address, word and a cryptographically random 32-byte salt. The contract exposes the same computation for interoperability. The word and salt must not enter creation calldata, logs, URLs or browser persistent storage. A user-exported recovery file intentionally contains both and must remain private. Browser compromise or sharing the file defeats answer secrecy.

The creator knows the answer and supplies provisional per-letter masks. Settlement checks the committed word and the entire bounded transcript. Guessing cannot reveal information beyond the creator's responses until the final opening. This is an interactive protocol, not a zero-knowledge proof system. It requires participants to monitor deadlines and submit transactions.

## Controls

- Caller authorization is enforced on-chain for joins, guesses, responses, concessions, reveals, cancellations and withdrawals.
- Game IDs only increase; game terms are immutable. Existing IDs cannot be recycled under pending transactions.
- Both stakes must match exactly. Per-game escrow only moves into credits once, at a terminal transition.
- The accounting invariant is `totalEscrow + totalCredits <= contract balance`; forced ETH can make the inequality strict. There is no surplus sweeping function.
- State changes and credit debits precede external withdrawal calls. Reentrancy is guarded; failed transfers revert and restore the credit. A claimant can choose a different recipient.
- No creator-winning timeout bypasses reveal validation. Missing a creator response or reveal loses the pot; challenger inactivity opens a reveal window.
- Inputs, words, misses, masks and transcript lengths are bounded. Read APIs are game-specific; the frontend loads bounded pages.
- UI writes require a permitted chain, account, deployed contract code, successful simulation, wallet approval and a successful receipt. Mainnet is not a permitted UI chain in this candidate.

## Known limits and economic assumptions

- There is no dictionary constraint; a creator can choose an obscure or nonsensical valid word. There is no claim of a fair random word distribution.
- Every action is a transaction. Gas, censorship, network congestion and missed deadlines can affect outcomes. The contract has no autonomous scheduler; someone must claim an elapsed timeout.
- A salted commitment hides the answer only if the salt is fresh and secret. Reusing a revealed word/salt pair can expose future games.
- There is no protocol fee or administrator. The original implicit 3% deduction was not retained because it lacked defined ownership/withdrawal rules. Any future fee or privilege requires an explicit design and review.
- Withdrawal credits have no expiry. Lost account keys cannot be recovered by an administrator. Lost answer recovery material can cause the creator to forfeit.
- The 1 ETH cap is per creator stake, not a global exposure cap. It is not a substitute for audit or a release risk limit.
- There is no migration or upgrade path from the legacy contracts. Their old arbitrary-payout vulnerability must not be used as a migration mechanism.
- The legacy folder contains known-vulnerable inactive code and an old lockfile. Root audits and new tests describe the active application only. Do not deploy or install the archived project.

## Evidence and independent review

Unit, fuzz, invariant, real-chain integration and browser tests cover different failure paths. Passing them is not a security certification. The release candidate still requires independent external contract review, a live-deployment inventory, gas measurements and testnet rehearsal before mainnet approval. Review findings and executed checks are recorded in `docs/verification.md` as work completes.
