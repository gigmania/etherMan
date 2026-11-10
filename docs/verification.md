# Verification record

Local candidate on `codex/etherman-modernization`, based on legacy commit `2d3e58cc5356e0a836e25896258f1f4e162b5ad3`. Checks were performed before the modernization commit; no push or public deployment was performed. Checks below ran on November 6, 2026, with Node 26.3.0/npm 12.0.1 on macOS arm64. Recommended development runtime is Node 24.15+ LTS.

## Reported-outage recovery candidate — November 10, 2026

Work began from committed/pushed `fa4b339` on `codex/etherman-modernization`,
following approval of the outage-handling plan. The candidate fixes an uptime
proxy at construction and provides permissionless 24-hour recovery grace from
first observation of a new healthy round. Detailed rules, source evidence,
external trust and indefinite active-escrow limits: [outage handling](outage-handling.md).

- 115 frontend tests and TypeScript pass after review remediation. Contract tests: 59 passed, including
  18 outage cases, 256 recovery-delay fuzz runs and 8,192 accounting invariant calls.
- Solidity/Vite production build passes; EtherMan runtime is 10,180 bytes.
- Real proof acceptance/rejection and replay tests pass. Actual proof-backed
  creation measured 4,024,248 gas locally. Dictionary/circuit/proof assets and
  recovery encoding are unchanged from the reviewed dictionary-v2 version.
- All 12 existing local integration scenarios pass. Three additional real-proof
  outage scenarios pass locally and on the Scroll state fork at block 35,675,217:
  prolonged outage with safe open refund/withdrawal; recovery synchronization,
  heartbeat stability, legitimate response during grace and reveal/withdrawal;
  unseen down/up recovery, automatic player-action synchronization and eventual
  forfeiture only after a full renewed opportunity.
- An additional locally deployed candidate bound to the actual official Scroll
  uptime proxy returned Ready at round 18446744073709552042. This validates a
  contract caller on the fork, not a public deployment or live outage guarantee.
- All five browser scenarios pass in 46.5 seconds, including a client-only RPC
  health-read failure while an independent client sees Ready, restoration of
  reads, actual simulated down/up status, permissionless synchronization, play
  during grace, reveal and withdrawal. The 28-letter private-proof creation
  scenario also passes. Initial fixture failures were a punctuation assertion
  and timestamp-dependent exact-gas estimation; a bounded 200,000-gas test-only
  limit resolved the latter (31,680 exact gas reverted; 37,188 was needed).
- A1 and B1 identified one medium-severity blocker: RPC failure was conflated with
  confirmed on-chain feed unavailability and wrongly promised paused timeouts.
  The fix adds a distinct unverified client status, preserves fail-closed UI
  controls, and warns that deadlines may continue. Initial, malformed, cached
  failure, confirmed-feed and browser cross-client cases now cover it.
  Review converged at **A2** on source hash
  `c7217b06eeeda4ad82a6b1a56c9f81e14d3e8292dc08b23b61387586de40c14c`.
  A2 independently verified all 88 file hashes and ran 108 affected frontend
  tests. No objective blockers remain. The prior low-severity deployment-helper
  wallet/client mismatch robustness item remains deferred; current callers use
  matching loopback transports. Full ledger: `outage-review.json`.
- The reviewed local candidate is deployed at
  `0x9a676e781a523b5d0c0e43731313a708cb607508` on chain 31337, using local simulation
  feed `0x610178dA211FEF7D417bC0e6FeD39F05609AD788`. `.env.local` and the running
  `http://127.0.0.1:5173/` app now point to it. Ready/round 1/recovery 0, the fixed
  dictionary root, initial game ID, UI configuration and word input were checked
  with no page errors. Earlier contracts remain present. Prior dictionary-v2
  configuration used `0x8a791620dd6260079bf849dc5567adc3f2fdc318` with source
  `fa4b339`; restore that matching source/configuration to access its old games.
  No public transaction or deployment was performed. These outage updates remain
  uncommitted. Local screenshot: `/tmp/etherman-outage-local.png`.


## Full dictionary v2 — November 9, 2026

User approved removing the arbitrary word-length filter, widening masks,
regenerating proofs, local rollout, and a read-only Scroll assessment. Baseline
v1 was committed as `23f32a3` before these changes; v2 work remains uncommitted.

- All 274,137 lowercase words from pinned `word-list@4.1.0` are included. Source
  entries range from 2 to 28 letters. The Merkle tree has depth 19, occupies
  32 MiB, and uses a 224-bit packed word.
- The creation input has no maxlength. Word fields use text semantics, default
  visible; creation retains optional CSS masking. Chromium verified show/hide
  and an unchanged 28-letter value. The user's personal Google Password Manager
  profile was not available to test.
- Build, TypeScript and 70 frontend tests pass. All 41 Foundry tests pass,
  including 8,192 invariant calls and highest-position transcript regressions.
- Real Solidity proofs pass for 2-, 15- and 28-letter words. Negative coverage
  includes all eight public-input mutations, copied/altered proofs, replay,
  invalid paths/padding/ranges and fresh high-chain context rejection. Actual
  local proof-backed creation measured 4,008,885 gas.
- All 12 local integration scenarios pass, including complete 2-, 15- and
  28-letter solved games through reveal/withdrawal and a 28-letter creator win.
  All 12 also pass on the Scroll state fork pinned to block 35,664,262. The first
  fork run hit an upstream state-fetch timeout; increasing the bounded fork read
  timeout from 15 to 60 seconds allowed the rerun to pass.
- All five browser scenarios pass. A longest-word assertion was corrected to
  count outer tiles rather than nested decorative spans, then passed. The
  response-word text-input change passed a targeted complete-game rerun. Actual
  28-letter proof creation, calldata/storage privacy checks and a 375px game
  layout pass.
- Node longest-word sample: 70 ms witness, 2,162 ms proof, 560,768 KiB process
  peak RSS. Development Chromium: 66 ms witness, 1,728 ms proof, 10,126.5 ms
  worker total. Production Chromium: 61.2 ms witness, 1,785.7 ms proof,
  10,258.6 ms total. Each returned 8,768 bytes and eight matching public inputs,
  with no page errors. These are desktop samples; browser/WASM memory and mobile
  performance remain unmeasured.
- Production dependency audit reports zero known vulnerabilities. No dependency
  versions changed. The full proof-build pipeline passes and reproduces the
  generated circuit, verifier and manifest identities.
- The native Scroll linked verifier accepts a real proof and rejects an altered
  root through read-only state overrides. Full-game cost model and limitations:
  [Scroll assessment](scroll-assessment.md). No public transactions were sent.

Independent review converged at **B1** on source fingerprint
`b09755606905d39f100db963f4fd9c3a16e3c2b4bed8d1c66890a4610dbc8362`.
Both reviewers verified all 83 frozen files and exact full-source normalization;
A ran 40 focused tests and B ran 53. No new objective blockers were found. The
prior low-severity deployment-helper wallet/client mismatch robustness item
remains deferred; current callers share a validated loopback transport. Details
are in `dictionary-review-v2.json`. This is not an external cryptographic audit.

The reviewed v2 bundle is now deployed locally at
`0x8a791620dd6260079bf849dc5567adc3f2fdc318`, chain 31337. `.env.local` points to it
and the running UI at `http://127.0.0.1:5173/` loaded the new address and v2 root.
On-chain root, 8,768-byte proof constant and initial game ID were verified. The
browser accepted two- and 28-letter dictionary words; text input/show-hide and
no maxlength passed, with no page errors. Earlier v1 and pre-dictionary contracts
remain present and unchanged. Local screenshot: `/tmp/etherman-v2-local.png`.

The wider response selector requires a fresh deployment. Preserve old contracts
and their previous matching UI/ABI (`23f32a3` for dictionary v1); Keccak encoding
and recovery version 1 stay unchanged. Local rollback restores previous source,
proof assets and deployment configuration; it does not migrate on-chain games.

## Dictionary-proof implementation — November 7, 2026

Approved local-only work adds actual zero-knowledge dictionary membership at creation.
Source identity and independent review ledger: [dictionary-review.json](dictionary-review.json).
Design, package pins, vocabulary provenance and trust assumptions:
[dictionary-proof.md](dictionary-proof.md).

- TypeScript and production build passed; npm audit reported zero known vulnerabilities.
- 59 frontend tests and all five Playwright tests passed, including an actual
  browser proof submitted to the generated Solidity verifier.
- 37 Foundry tests passed, including 8,192 invariant calls. Mock verifiers in
  these tests isolate contract boundaries; actual-proof coverage is separate.
- `npm run test:proof` passed all eight public-input mutation checks, malformed
  and copied proof checks, atomic failure, commitment replay/new-salt cases,
  circuit word/padding/path/range failures, and high-chain/word-length boundaries.
- Eight complete-game integration scenarios passed with actual proofs on local
  Anvil and a Scroll state fork pinned to block 35,639,573.
- Chromium production-bundle proof: 74 ms witness, 1,787 ms proving, 10,188 ms
  total including loading; 8,768-byte proof, no page errors. Node peak process
  RSS was 408,480 KiB; browser/WASM peak memory and mobile performance unmeasured.
- Actual game creation used 4,008,996 gas on Anvil. This is not a native Scroll
  execution result or a complete Scroll fee quote.

Independent security review converged at **B1** on source hash
`45f14b550eeb0c30011cf798316d2dff247ca09a466e8846e256f0ff2ffb884e`.
No objective blockers were found. Both reviewers independently reproduced one
low-severity robustness issue: the reusable deployment helper checks the read
client, not the separately supplied wallet. All current callers use the same
loopback transport; defensive wallet validation is deferred before helper reuse.
See the review ledger for evidence and scope.

After convergence, deployed the reviewed bundle only to the existing loopback
Anvil chain 31337 at `0x5fc8d32690cc91d4c39d9d3abcbd16989f875707` and updated
ignored `.env.local`. The prior contract
`0xe7f1725e7734ce288f8367e1bb143e90bb3f0512` remains untouched. Local UI smoke
confirmed the new address, word visibility control and zero browser errors.

No public deployment, mainnet signing, timeout redesign, or external audit was
performed. The older review below applies only to its original candidate.

## Scroll preparation follow-up — November 6, 2026

After the modernization commit, added `chain:scroll` for local fork rehearsal.
Verified the public Scroll RPC reports chain ID 534352. Started the new command
on isolated loopback port 18545 with local chain ID 31337 at upstream block
35,635,837. Deployed the existing compiled EtherMan artifact locally; its receipt
succeeded and `nextGameId()` returned 1. Stopped the temporary fork afterward;
the existing development chain was left running. TypeScript and diff whitespace
checks passed. These checks do not cover full games, native Scroll execution,
proving, finality, or live-network fees. No public transaction was sent.

### Full Scroll state-fork rehearsal

`npm run test:integration:scroll` rebuilt the contract and passed all eight
integration scenarios at upstream Scroll block 35,635,940, executing only on
disposable local Anvil (chain ID 31337). The ordinary `test:integration` suite
also passed all eight scenarios after the helper changes. Unknown CLI options
were checked to exit unsuccessfully before starting a chain.
All five Playwright browser tests passed with the shared helper changes.

Initial fork runs exposed inherited EIP-7702 delegation at three standard Anvil
test addresses. A minimal local transfer to the fourth default account also
reproduced the unexpected balance change without EtherMan. Fork commands now
generate fresh local accounts instead of inheriting those accounts' code and
history. A separate receipt-timing issue stalled the block-driven receipt
waiter after a block became visible before its receipt. Fork tests now poll the
specific receipt directly with a 30-second polling deadline, retrying only receipt-not-found
errors. Production wallet transaction handling has not changed.

These are state-fork tests, not native Scroll execution or proving evidence;
no Scroll mainnet transaction was submitted. The dictionary verifier, outage
policy, actual Scroll fees, and native execution validation remain outstanding.

The historical review manifest below identifies the earlier reviewed candidate;
it does not cover subsequent UI and package-script edits.

## Executed checks (modernization baseline)

| Check | Result |
| --- | --- |
| `npm run build` | Solidity 0.8.38, TypeScript and Vite production build pass; contract runtime 7,612 bytes |
| `npm test` | 44 frontend domain, transaction-provider and component tests pass |
| `npm run test:contracts` | 28 pass: 25 focused, two fuzz tests with 256 runs each, one stateful invariant with 128 runs / 8,192 calls |
| `npm run test:integration` | Eight disposable-Anvil scenarios pass |
| `npm run test:e2e` | Five Chromium browser tests pass, including complete game/reveal/withdrawal |
| Root `npm audit` | Zero advisories after `solc` → `tmp` override to 0.2.7 |
| Archive integrity | All 70 archived files match their original HEAD contents byte for byte |
| Native Foundry exit propagation | Deliberately invalid CLI argument returns nonzero through project launcher |
| Production-build browser smoke | Practice completes against built assets with zero browser exceptions |
| Local deployment identity | Runtime bytecode matches compiled artifact; keccak256 `0x9f3e094d8a21a6ba825af81bb161a6c821b8ff1df7835aea6c054050d5461355` |
| Visual inspection | Desktop 1440px and mobile 390px screenshots inspected; no overflow or browser exceptions; browser tests additionally check 375px across all routes |

The browser harness uses one exposed account at a time, a disposable Anvil chain, and a controlled injected provider. It tests wallet rejection, wrong-network prevention/switching, account-role changes, state restoration after reload, recovery download/acknowledgement, absence of recovery secrets in creation calldata or persistent browser storage, reveal, and actual withdrawal-credit depletion. It is not a test of every browser wallet extension or hardware wallet.

An initial test provider forwarded `eth_sendTransaction` without wallet-style gas padding. A deterministic reproduction estimated 36,268 gas immediately after joining; mining the guess one second later changed the cost of updating the deadline and exhausted that exact gas limit. A call trace confirmed `out of gas`. The test wallet now adds an estimation margin, and a dedicated integration scenario verifies the timestamp-change case. Product expectations were not relaxed.

## Internal review ledger

Initial application-source fingerprint: `e73ad04b0d0b38fd40e4b65c126cf76278af3e4fcf3a1e88e5371cb8448812de` (candidate-source-v1). The manifest includes contract, frontend except generated ABI, Foundry tests, dependency lockfile, build configuration and compilation/local-deployment/native-launcher tooling.

| ID / originating pass | Finding and evidence | Validity / triage / confidence | Resolution |
| --- | --- | --- | --- |
| V2-A1-01 / A1, confirmed B1 | Replacement receipt could confirm a cancelled or unrelated action (`web/chain.tsx`) | Accepted; blocks objective; high | Actual mined sender, destination, calldata, value, status and hash are verified; provider regressions cover original/speedup/cancellation/changed fields/revert |
| V2-A1-02 / A1, confirmed B1 | Uncertain creation could reuse the same word commitment (`web/App.tsx`) | Accepted; blocks objective; high | Prepared commitment is consumed synchronously before awaiting submission; first recovery is retained; another attempt requires a fresh salt/download; component regression covers late undefined completion |
| V2-B1-01 / B1 | Delayed zero-mask response could apply to the next letter (`contracts-v2/EtherMan.sol`) | Accepted; blocks objective; high | `respond(id, expectedLetter, mask)` rejects stale turns before mutation; unit and mined-transaction regressions verify unchanged state and subsequent honest completion |
| V2-A1-03 / A1, confirmed B1 | Withdrawal destination persisted through account switch | Accepted; improves robustness; high | Recipient/error reset on account change; component regression |
| V2-A1-04 / A1, confirmed B1 | Empty final word was always described as timeout | Accepted; improves robustness; high | Neutral settlement wording |
| V2-A1-05 / A1, confirmed B1 | Game/transcript reads could observe different blocks | Accepted; improves robustness; high | Both reads pinned to the same block; provider regression |
| B1 response-input follow-up | Loaded recovery could be mistyped before auto-generating positions | Accepted; improves robustness; high | Loaded word/salt checked against commitment before response; component regression |

Converged application artifact: **candidate-source-v2**, fingerprint `28002369a19e727c7e5f14efe8a32b8d2df8b91d15953a2a58bd9d0c2fe9d6e1`. Individual hashes and the fingerprint are preserved in [review-manifest.json](review-manifest.json). The fingerprint is SHA-256 of Python's `json.dumps(files, sort_keys=True)` output from that manifest; paths map to each file's SHA-256. Generated ABI and documentation are outside the manifest; ABI was regenerated and its response signature checked against source.

Review order was **A1 → B1 → A2**, with the same independent reviewer contexts retained. A1 identified two blockers; B1 independently confirmed them and identified the stale-turn blocker. Remediation and relevant checks followed B1. A2 inspected the revised source and regression tests, verified every manifest hash, found all accepted blockers resolved and no new objective blocker, and confirmed compatibility with B1's requirements. The parent declared convergence at **A2** for the local/testnet implementation objective. No extra B2 pass was run because the protocol permits exit at A2 once the evidence and reviewer positions converge.

This is internal review, not an external audit or public-release approval. Mainnet readiness is not established. Remaining operational/product decisions are listed in the release checklist rather than silently accepted as production risk.

## Gas and remaining limits

`node tools/foundry.mjs forge test --gas-report --match-contract EtherManTest` passed all 27 selected unit/fuzz tests. Sample maximum measured function gas in that suite: create 163,681; join 65,620; guess 38,977; response 125,579; reveal 132,990; withdrawal 50,519. These are sampled test measurements, not exhaustive worst-case bounds, transaction-cost quotes, or a mainnet gas budget.

The production build currently emits a wallet-library browser-externalization warning for `node:worker_threads` and a chunk-size warning (approximately 648 kB main JS before gzip). Exercised browser flows work; bundle splitting and broader browser/wallet performance testing remain follow-ups.

Countdowns use browser wall-clock estimates; contract timestamps remain authoritative. Incorrect device time or local-chain time travel can make displayed action eligibility inaccurate. This is a known candidate UX limitation to address before a public release.

No public testnet/mainnet transactions, fork tests against an identified deployed contract, external audit, formal verification, production monitoring, or migration rehearsal have been performed. See [release gates](release.md). Passing these checks does not certify security.
