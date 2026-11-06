# Release gates

Status: local/testnet candidate; no public deployment approved or performed.

## Before testnet

1. Confirm whether any legacy deployment exists, its network/address, deployed bytecode, ownership, balance and active users. Repository metadata only records network 4447 and does not prove that other deployments do not exist.
2. Approve the candidate rules: interactive creator, 24-hour turns, seven-day expiry, 3–12 lowercase letters, 1–8 misses, maximum 1 ETH stake, zero fee, no dictionary enforcement, no administrator or upgrade proxy.
3. Complete the automated checks and independent code/security review on a fixed source revision. Record compiler, optimizer, EVM target, ABI, runtime bytecode and dependency lockfile hashes.
4. Measure creation, per-letter response, worst-case reveal, timeout and withdrawal gas. Present expected complete-game transaction costs.
5. Prepare a concrete Sepolia deployment transaction, deployment owner, RPC, explorer verification, addresses and frontend configuration for approval. Do not place secrets in `VITE_*` variables: they are public browser configuration.

## Before mainnet

1. Resolve all accepted release-blocking findings and obtain independent external contract security review.
2. Rehearse complete games, rejection/revert recovery, account/network changes, lost recovery material, dishonest responses, elapsed deadlines and smart-contract-wallet withdrawals on testnet.
3. Decide whether the per-turn L1 gas cost is acceptable for the product. Any alternative chain or off-chain protocol is a new explicit deployment/design decision.
4. Establish monitoring for escrow/credit accounting, failed transactions, unclaimed credits, overdue games, RPC availability and frontend artifact integrity. Assign an operational owner and a user-support process.
5. Evaluate product and jurisdiction requirements for a public wagered game with qualified advice before opening it to users.
6. Present exact source/artifact identity, destination chain, costs, signing mechanism, contract address derivation, launch limits, public UI artifact and post-deployment verification for approval.
7. Add mainnet support only in the approved release change. Current UI rejects chain 1. No production deployment command is provided in this candidate.

## Rollback and incident response

Local rollback is restoring the previous source revision and reinstalling its lockfile; the 2018 archive must never become the public wager contract. Anvil can be restarted and the candidate redeployed for local work.

On-chain deployment is immutable. There is no admin pause, forced refund, or proxy rollback. Removing or disabling the public frontend stops neither direct contract calls nor deadline progression. An incident plan must keep users informed and preserve access to legitimate cancellation, timeout and withdrawal paths; it cannot promise to reverse settled transactions. A new contract deployment requires a new address and explicit adoption. Existing user funds cannot be silently migrated.
