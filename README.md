# EtherMan

Two-player Hangman with committed answers and an Ethereum escrow contract. This is a **local/testnet development candidate**, not a mainnet release. The original 2018 implementation is preserved in `legacy/` and is excluded from the active build and test suite.

## Run locally

Use Node 24 LTS, version 24.15 or newer (`.nvmrc`). Install pinned dependencies and compile the contract:

```sh
npm ci
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

## Game rules

- The creator selects 3–12 lowercase letters, 1–8 allowed misses, and a stake greater than zero and at most 1 ETH. Dictionary membership is not enforced; agree on acceptable words with your opponent.
- The creator downloads a private recovery file before creating the game. It contains the answer and a random salt: keep it private and keep it until settlement. Losing it can forfeit the stake.
- The challenger matches the exact stake. Each guess and response gets a 24-hour deadline. The creator must actively respond with **every** matching letter position.
- Responses are provisional. After completion, concession, or challenger inactivity, the creator reveals the answer and salt. The contract verifies the commitment and every prior response before awarding funds.
- A dishonest transcript or a missed creator response/reveal deadline awards the pot to the challenger. Challenger inactivity first requires a creator reveal; it does not bypass honesty checks.
- Unjoined games can be cancelled by their creator; anyone can expire them after seven days. Funds become withdrawal credits. Claiming a deadline and withdrawing each require a transaction.
- There is no protocol fee, administrator, upgrade proxy, oracle, or background automation. Network gas is additional to the stake. Both players need enough gas to finish or claim deadlines.

Full transition rules and interfaces: [protocol](docs/protocol.md). Threat model and remaining release work: [security](docs/security.md), [release checklist](docs/release.md).

## Development and verification

```sh
npm run build              # solc 0.8.38, generated ABI, TypeScript, production frontend
npm test                   # frontend rules, values, secrets and interaction tests
npm run test:contracts     # Foundry unit, fuzz and stateful accounting tests
npm run test:integration   # disposable local Anvil; real deployment and transactions
npx playwright install chromium
npm run test:e2e           # browser tests
npm audit                 # root dependency advisories
```

Foundry binaries are pinned npm dependencies. Its first test run may download the pinned native Solidity compiler. The project wrapper propagates native test failure exit codes. `solc`'s `tmp` dependency is overridden to patched `0.2.7`; do not remove this override until upstream fixes the pin. Install scripts are not needed when the supported platform's optional Foundry binaries are installed.

`npm run check` runs build, frontend, contract, and local-chain integration checks. Browser tests are a separate explicit command. Tests and scripts only use disposable/local chains; they never broadcast to mainnet or Sepolia.

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
