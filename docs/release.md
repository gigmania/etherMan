# Release gates

Status: local/testnet candidate; no public deployment approved or performed.

## Selected network: Scroll

The selected production destination is Scroll (chain ID 534352). This decision
does not enable mainnet signing or authorize a deployment transaction.
The [official Scroll docs](https://docs.scroll.io/en/developers/scroll-contracts/)
report Scroll Sepolia retired after July 30, 2026. Its former chain ID 534351
and endpoints must not be used for a new rehearsal.

Use `npm run chain:scroll` for local fork rehearsals, retaining local chain ID
31337 and test accounts. Record the upstream block for reproducibility. Fork
results are Anvil execution evidence, not proof of Scroll execution/proving
compatibility or live-network fee behavior. Before a public deployment, establish
a maintained Scroll-native rehearsal environment and validate the actual
compiler output and implemented dictionary verifier there.

The read-only verifier and complete-game fee assessment is recorded in
[`scroll-assessment.md`](scroll-assessment.md); it does not establish transaction
inclusion or rollup finalization. The [release-hardening candidate](release-hardening.md)
adds pre-sign fee review, separate inclusion/finality observations, and pinned
local deployment checks. Before launch, validate these against live complete-game
fees and finality, and accept the reported-outage recovery policy and its external feed/delivery
limits. The candidate implements permissionless 24-hour recovery grace; see
[outage handling](outage-handling.md). Dictionary enforcement is implemented in the local candidate, but is not
publicly deployed or externally audited. The fixed 274,137-word vocabulary comes
from `word-list@4.1.0` with MIT/CC0-1.0 provenance retained in `dictionary/`.
The constructor fixes the root and verifier; neither can be updated by an admin.
A vocabulary, circuit, or verifier change requires a new deployment.

The proof uses Noir 1.0.0 and Barretenberg 6.0.0 in zero-knowledge EVM mode and is
8,768 bytes. The generated Solidity verifier measured about 3.84 million gas on
local Anvil. This is neither a full creation estimate nor a Scroll fee quote.
Record browser time/memory and actual Scroll execution/data fees before launch.

## Before testnet

1. Confirm whether any legacy deployment exists, its network/address, deployed bytecode, ownership, balance and active users. The user believes the original app was testnet-only, so a fresh deployment is the working assumption; no address has been supplied to verify it. Repository metadata only records network 4447 and does not prove that other deployments do not exist.
2. Approve the candidate rules: interactive creator, 24-hour turns, seven-day expiry, a dictionary word in lowercase letters, 1–8 misses, maximum 1 ETH stake, zero fee, private dictionary-proof enforcement, permanent commitment consumption, no administrator or upgrade proxy. Keep the current salted Keccak commitment and version-1 recovery format; existing games remain tied to their original contracts.
3. Complete the automated checks and independent code/security review on a fixed source revision. Record compiler, optimizer, EVM target, ABI, runtime bytecode, circuit, verification key, linked verifier libraries, dictionary/root, proving assets and dependency lockfile hashes. Verify zero-knowledge mode and proving-parameter provenance. Mock-verifier tests alone do not establish cryptographic validity.
4. Measure creation, per-letter response, worst-case reveal, timeout and withdrawal gas. Present expected complete-game transaction costs.
5. Identify a maintained rehearsal environment for Scroll before preparing a public test deployment transaction, deployment owner, RPC, explorer verification, addresses and frontend configuration for approval. Ethereum Sepolia support in the current frontend is not a Scroll rehearsal. Do not place secrets in `VITE_*` variables: they are public browser configuration.

## Before mainnet

1. Resolve all accepted release-blocking findings, including acceptance of uptime-feed trust, delivery-gap and indefinite active-escrow risks, and obtain independent external contract/circuit security review. Confirm the generated verifier, linked libraries, root, official uptime proxy, initial feed round, and browser proving assets match the reviewed artifacts. Never use the chain-31337-only LocalSequencerFeed fixture in a public release.
2. Rehearse complete games, real-proof acceptance/rejection, invalid words and altered inputs, copied proofs and replay, worker cancellation/stale results, rejection/revert recovery, account/network changes, lost recovery material, dishonest responses, elapsed deadlines and smart-contract-wallet withdrawals in a maintained Scroll-native rehearsal environment.
3. Validate Scroll complete-game fees, including L2 execution and Ethereum data fees, against the product budget. Any different chain or off-chain protocol is a new explicit deployment/design decision.
4. Establish monitoring for escrow/credit accounting, failed transactions, unclaimed credits, overdue games, RPC availability and frontend artifact integrity. Assign an operational owner and a user-support process.
5. Evaluate product and jurisdiction requirements for a public wagered game with qualified advice before opening it to users.
6. Present exact source/artifact identity, destination chain, costs, signing mechanism, contract address derivation, launch limits, public UI artifact and post-deployment verification for approval.
7. Add mainnet support only in the approved release change. Current UI rejects both Ethereum mainnet (1) and Scroll mainnet (534352). No production deployment command is provided in this candidate.

## Rollback and incident response

Local rollback is restoring the previous source revision and reinstalling its lockfile; the 2018 archive must never become the public wager contract. Anvil can be restarted and the candidate redeployed for local work.

On-chain deployment is immutable. There is no admin pause, forced refund, or proxy rollback. Removing or disabling the public frontend stops neither direct contract calls nor deadline progression. An incident plan must keep users informed and preserve access to legitimate cancellation, timeout and withdrawal paths; it cannot promise to reverse settled transactions. A new contract deployment requires a new address and explicit adoption. Existing user funds cannot be silently migrated.
