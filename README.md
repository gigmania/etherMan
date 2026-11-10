# EtherMan

Two-player Hangman with committed answers and an Ethereum escrow contract. This is a **local/testnet development candidate**, not a mainnet release. The original 2018 implementation is preserved in `legacy/` and is excluded from the active build and test suite.

## Run locally

Use Node 24 LTS, version 24.15 or newer (`.nvmrc`). Install pinned dependencies and compile the contract:

```sh
npm ci
npm run proof:build
npm run contracts:build
```

Start Anvil in one terminal:

```sh
npm run chain
```

In a second terminal:

```sh
npm run deploy:local
```

Copy the printed `VITE_CHAIN_ID`, `VITE_RPC_URL`, and `VITE_CONTRACT_ADDRESS` values into `.env.local`, then run:

```sh
npm run dev
```

Open the local URL printed by Vite (normally http://127.0.0.1:5173). Practice mode works without a wallet. For on-chain play, connect a browser wallet configured for RPC `http://127.0.0.1:8545`, chain ID `31337`, currency ETH. Use two separate local test accounts for creator and challenger. Anvil's publicly known development accounts and keys must **never** hold real funds. The frontend never requests a seed phrase or private key.

Anvil state is ephemeral. Restarting it removes local games and deployments; run `deploy:local` again and update `.env.local` if the address changes. The deploy script only accepts the Anvil process at loopback port 8545 with chain ID 31337. It uses unlocked local accounts and has no private-key or remote-network option.

## Scroll development target

Scroll is the selected deployment target. Its mainnet chain ID is `534352`, but
mainnet signing remains disabled in this candidate. Scroll Sepolia was retired
after July 30, 2026; do not configure its old RPC for new deployments. See the
[official network documentation](https://docs.scroll.io/en/developers).

For local rehearsal using Scroll state, stop your existing Anvil process and
start this instead of `npm run chain`:

```sh
npm run chain:scroll
```

Then follow the same `deploy:local` and frontend steps above. This runs Anvil on
loopback with local chain ID `31337`, reads upstream Scroll state, and executes
transactions locally using test ETH. It does not deploy or broadcast to Scroll.
The fork needs a working upstream RPC. For reproducible runs, append
`-- --fork-block-number <block>` and record the block; the provider must retain
that block's state. Restarting replaces the local session and requires redeploying.

Each fork starts with fresh local development accounts. Use the test accounts
printed by that Anvil session for wallet setup; they change on restart. This
avoids inheriting delegated code and transaction history at the publicly known
default Anvil addresses on Scroll. These generated accounts are for local test
ETH only, and their keys must never be used for real funds.

Anvil executes its own EVM: this rehearsal does not reproduce Scroll's prover,
sequencer, finality, opcode differences, or complete L1 data fees. Native Scroll
execution and fee validation remain release gates. The private dictionary-membership proof is implemented and tested locally.
Reported-outage recovery is implemented; its external-feed and delivery limits remain release considerations.

Run the twelve gameplay integration scenarios against a disposable Scroll state
fork with `npm run test:integration:scroll`. The command rebuilds the contract,
checks the upstream chain ID, prints and pins the upstream block, uses a separate
loopback port, and stops its fork when finished. It needs network access for
read-only RPC requests; the ordinary `test:integration` command stays local.

## Game rules

- The creator selects a dictionary word in lowercase letters, 1–8 allowed misses, and a stake greater than zero and at most 1 ETH. The word must belong to the fixed 274,137-word game dictionary. A private proof is verified before a game can be created.
- The creator downloads a private recovery file before creating the game. It contains the answer and a random salt: keep it private and keep it until settlement. Losing it can forfeit the stake.
- The challenger matches the exact stake. Each guess and response gets a 24-hour deadline. The creator must actively respond with **every** matching letter position.
- Reported sequencer recovery starts a 24-hour grace period when recorded on-chain. Anyone can synchronize recovery; ordinary play is allowed during grace. Active timeout losses are blocked while the feed is down, unavailable, or awaiting synchronization. Open refunds and withdrawals remain available. See [outage rules and limitations](docs/outage-handling.md).
- Responses are provisional. After completion, concession, or challenger inactivity, the creator reveals the answer and salt. The contract verifies the commitment and every prior response before awarding funds.
- A dishonest transcript or a missed creator response/reveal deadline awards the pot to the challenger. Challenger inactivity first requires a creator reveal; it does not bypass honesty checks.
- Unjoined games can be cancelled by their creator; anyone can expire them after seven days. Funds become withdrawal credits. Claiming a deadline and withdrawing each require a transaction.
- There is no protocol fee, administrator, upgrade proxy, external word oracle, or background automation. The dictionary root and proof verifier are immutable. Network gas is additional to the stake. Both players need enough gas to finish or claim deadlines.

The proof is generated in a browser worker after you save the recovery file. It takes CPU and memory and can be cancelled before wallet submission. A commitment cannot be reused, even after cancellation. See [proof design and benchmarks](docs/dictionary-proof.md) for the accepted vocabulary, trust assumptions, and performance limits.

Before each transaction, review the stake separately from estimated network fees, then continue to your wallet. Inclusion and finality are shown separately. See [release hardening](docs/release-hardening.md) for artifact checks and estimate/finality limits.

Full transition rules and interfaces: [protocol](docs/protocol.md). Threat model and remaining release work: [security](docs/security.md), [release checklist](docs/release.md).

## Development and verification

```sh
npm run proof:build        # reproduce dictionary tree, circuit, verifier, and browser assets
npm run release:verify     # verify built artifacts against the reviewed release manifest
npm run test:release       # local deployment guards, artifact tampering and actual bundle checks
npm run test:outage        # real-proof outage, recovery, settlement and withdrawal flows
npm run test:outage:scroll # local fork plus actual official Scroll uptime proxy
npm run test:proof         # actual ZK proofs, Solidity verifier, altered-input and replay tests
npm run build              # solc 0.8.38, generated ABI, TypeScript, production frontend
npm test                   # frontend rules, values, secrets and interaction tests
npm run test:contracts     # Foundry unit, fuzz and stateful accounting tests
npm run test:integration   # disposable local Anvil; real deployment and transactions
npx playwright install chromium
npm run test:e2e           # browser tests
npm audit                 # root dependency advisories
```

Foundry binaries are pinned npm dependencies. Its first test run may download the pinned native Solidity compiler. The project wrapper propagates native test failure exit codes. `solc`'s `tmp` dependency is overridden to patched `0.2.7`; do not remove this override until upstream fixes the pin. Install scripts are not needed when the supported platform's optional Foundry binaries are installed.

`npm run check` runs build, release safeguards, frontend, contract, actual-proof, and local-chain integration checks. Normal builds do not update the trusted release manifest; see [release hardening](docs/release-hardening.md) for intentional manifest updates. Run `proof:build` first after a fresh checkout or a circuit/dictionary/toolchain change; it creates ignored assets under `public/zk/`. The first proving run fetches public CRS parameters from the backend's fixed CDN endpoints. It does not send the word, salt, or witness. Browser tests are a separate explicit command. Tests and scripts only use disposable/local chains; they never broadcast to mainnet or Sepolia.

## Layout

| Path | Purpose |
| --- | --- |
| `web/` | React, TypeScript, wagmi/viem, responsive UI and frontend tests |
| `contracts-v2/EtherMan.sol` | Current escrow and game state machine |
| `test-v2/` | Self-contained Foundry tests and invariant handler |
| `tools/` | Compilation, local deployment and integration tooling |
| `web/generated/etherManAbi.ts` | Generated ABI; regenerate with `contracts:build` |
| `legacy/` | Inactive 2018 source, dependencies and deployment artifacts |

The active frontend supports Local Anvil and Sepolia only. A missing deployment configuration leaves practice mode available. Mainnet signing is disabled. Existing deployments and balances have not been inventoried; no migration is implemented or implied.
