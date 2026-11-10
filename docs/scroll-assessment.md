# Scroll read-only assessment — November 9, 2026

The expanded-dictionary verifier passes actual Scroll RPC execution using
read-only `eth_call` state overrides: a real longest-word proof is accepted and
an altered root is rejected. No public transaction was sent and no funds were
spent. This is execution evidence, not transaction inclusion, rollup proving or
finalization evidence.

## Reproduce

After `npm run proof:build`, `npm run contracts:build`,
`npm run proof:benchmark` and `npm run test:integration`, run:

```sh
node tools/assess-scroll.mjs
```

The script deploys only to a disposable loopback Anvil, retrieves the initialized
verifier/library runtime and preserves their linked addresses in Scroll state
overrides. Compiler runtime templates alone are unsuitable: zeroed immutable
placeholders produce a proof-size arithmetic underflow. The public RPC accepts
`eth_call` overrides but rejects a third override parameter on `eth_estimateGas`;
the script therefore binary-searches successful call gas within 1,000 units.
Synthetic transactions are signed locally with public development key 1 solely
to measure encoded size. There is no send client for Scroll.

## Execution and size results

Snapshot: block **35664261**, chain **534352**, block gas limit
**20,000,000**, sampled gas price **120108 wei**.

- Native verifier successful call budget: **3,841,446 gas**
  (search tolerance 1,000); matching local estimate: **3,841,088**.
- Verifier calldata: **9,156 bytes**, including the 8,768-byte proof.
- Runtime/init-code sizes:

| Artifact | Runtime bytes | Init-code bytes |
| --- | ---: | ---: |
| HonkVerifier | 18,578 | 18,905 |
| RelationsLib | 8,254 | 8,306 |
| ZKTranscriptLib | 6,089 | 6,141 |

The verifier uses modular exponentiation and BN254 addition, multiplication and
two-pair pairing checks. These are supported by the
[pinned Scroll precompile implementation](https://github.com/scroll-tech/go-ethereum/blob/c06c4243c1397b88bb162675385373a0e010c79f/core/vm/contracts.go).
Native precompile smoke checks also passed. Application code does not use the
opcodes with documented differing randomness, coinbase, self-destruct or blob
behavior. [Official EVM differences](https://docs.scroll.io/en/developers/ethereum-and-scroll-differences/).

Runtime/init-code sizes fit the 24,576/49,152-byte source limits, and creation
calldata fits the source transaction-pool 128 KiB and default block-payload
120 KiB ceilings. These are client-source limits/defaults, not a guarantee of
current sequencer admission settings.
[Protocol limits](https://github.com/scroll-tech/go-ethereum/blob/c06c4243c1397b88bb162675385373a0e010c79f/params/protocol_params.go),
[pool validation](https://github.com/scroll-tech/go-ethereum/blob/c06c4243c1397b88bb162675385373a0e010c79f/core/tx_pool.go),
[configuration](https://github.com/scroll-tech/go-ethereum/blob/c06c4243c1397b88bb162675385373a0e010c79f/params/config.go).

## Complete-game fee model

These are representative games through reveal and withdrawal, not exhaustive
worst cases. Stakes are excluded. Creator and challenger each pay gas for their
own actions. Local transaction gas is adjusted on creation by the native/local
verifier difference; other actions use local EVM measurements. Each transaction
uses the same sampled Scroll gas price and pinned-block oracle state.

| Scenario | Transactions | Creator ETH | Challenger ETH | Total ETH |
| --- | ---: | ---: | ---: | ---: |
| two-letter-solved | 6 | 0.000151227 | 0.000004084 | 0.000155311 |
| over-twelve-solved | 26 | 0.000169413 | 0.000019348 | 0.000188760 |
| longest-solved | 30 | 0.000173101 | 0.000022400 | 0.000195501 |
| longest-creator-win | 6 | 0.000152477 | 0.000002837 | 0.000155314 |

The live oracle at `0x5300000000000000000000000000000000000002` reports Galileo
mode. Galileo charges using the compressed signed-transaction size, capped at
raw size. This assessment calls `getL1Fee` with the complete **uncompressed**
signed transaction, yielding a conservative data-size upper bound at the sampled
oracle parameters. It does not claim a maximum future fee or an exact compressed
fee. Gas prices, Ethereum data prices, transaction compression and gameplay
choices can change costs.
[Current client fee calculation](https://github.com/scroll-tech/go-ethereum/blob/c06c4243c1397b88bb162675385373a0e010c79f/rollup/fees/rollup_fee.go),
[oracle implementation](https://github.com/scroll-tech/scroll-contracts/blob/dfbd661520ac30505a773881728cc5cfb005978b/src/L2/predeploys/L1GasPriceOracle.sol),
[fee documentation](https://docs.scroll.io/en/developers/transaction-fees-on-scroll/).

## Remaining release gates

Scroll Sepolia shut down after July 30, 2026, so its former endpoints cannot be
used for a new rehearsal. [Official network documentation](https://docs.scroll.io/en/developers/).
A maintained native rehearsal environment and inclusion/finalization testing
are still needed. Read-only verifier execution does not exercise full game
storage transitions on Scroll or prove sequencer acceptance.

Resolve outage fairness for 24-hour turns, obtain external contract/circuit
security review, measure mobile proving memory/latency, confirm complete-game
costs against the product budget, and prepare the exact production rollout
before a mainnet release. The UI still rejects Scroll mainnet signing. See
[release gates](release.md).
