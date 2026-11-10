# Release hardening candidate

Scope: local implementation and verification on `codex/etherman-modernization`,
starting from `97a8dc6`. Scroll remains the selected production destination;
public deployment and mainnet signing remain disabled. No game rules, contracts,
dictionary, circuit, or recovery-file format change in this workstream.

## Deployment and artifact identity

The local deployment path checks the reader and signing wallet before sending
any transaction. Both must identify the same loopback Anvil endpoint and chain
31337. A local reader cannot authorize a separately configured remote wallet.
The release manifest is a tracked review input, not a file automatically blessed
by a normal build. Source or artifact drift must fail verification until the
candidate is rebuilt and its changed manifest explicitly regenerated and reviewed.

Deployment verifies compiler settings, creation and runtime templates, library
links, constructor immutables, dictionary root, verifier, and uptime-feed policy.
A successful receipt alone does not establish artifact identity. Local simulation
feeds are for disposable development chains only. The official Scroll proxy is
allowed only for local Scroll fork rehearsal by the local deployment helper.
There is no public deployment command.

The checked-in manifest and validation tools are integrity controls within the
reviewed checkout. They are not an independent signing authority, reproducible
build attestation, or defense against an attacker who can replace the tooling and
manifest together. Preserve the source review hash and use a clean checkout when
preparing a future signed release.

To verify the current candidate after building:

```sh
npm run contracts:build
npm run release:verify
npm run test:release
```

After an intentional contract/toolchain change, rebuild first, then use
`npm run release:manifest` to generate the proposed `release/manifest.json`
update. Review the diff and repeat validation before accepting it. This command
prepares local review material; it does not approve or deploy a release. The
manifest checks source hashes against compiler metadata, so stale artifacts
cannot be accepted merely by refreshing the manifest.

## Fee review

Before wallet submission, the UI separates ETH sent to the contract as stake
from network fees. Estimates depend on current state and network prices; they
are not guaranteed future charges. The wallet remains the final signing surface.
An unavailable estimate is distinct from a zero fee, and an expired estimate
requires refresh after 30 seconds. Continuing reruns simulation and estimation;
an increased estimate returns to review. The call and account are bound to the
review, and wallet/network changes are checked again before signing. The review
does not store or display reveal words or salts.

Scroll fees have two components: L2 execution and L1 data publication. The
[official oracle API](https://docs.scroll.io/en/developers/transaction-fees-on-scroll/)
takes a fully encoded signed transaction, not just contract calldata. The
[pinned Galileo fee implementation](https://github.com/scroll-tech/go-ethereum/blob/c06c4243c1397b88bb162675385373a0e010c79f/rollup/fees/rollup_fee.go)
uses compressed transaction size capped at its raw size; using raw encoded size
provides a conservative data-fee estimate for the modeled transaction at the
sampled oracle parameters. The UI models a legacy EIP-155 envelope with
conservative nonce/signature widths and sends only synthetic nonzero bytes of
that length to the fee oracle; it does not send reveal contents to that oracle.
The model is not a cap on later prices or wallet edits.
Mainnet remains disabled; Scroll-specific calculations require native transaction
rehearsal before release.

## Inclusion and finality

A validated successful receipt means the intended transaction was included.
Game state can refresh at that point; play does not wait for rollup finality.
Finality is a separate RPC observation. The receipt block must still match the
canonical block at its height, and the RPC's finalized head must cover it and
match the canonical block at that head's height.
Failed or unsupported observations cannot imply finality. A changed block hash
must be reported instead of retaining a success claim.

Scroll's [transaction lifecycle](https://docs.scroll.io/en/technology/chain/transactions/)
separates L2 inclusion, publication to Ethereum, and validity-proof finalization.
Its [RPC implementation](https://github.com/scroll-tech/go-ethereum/blob/c06c4243c1397b88bb162675385373a0e010c79f/eth/api_backend.go)
serves the finalized tag only when rollup verification is enabled. The
[rollup synchronizer](https://github.com/scroll-tech/go-ethereum/blob/c06c4243c1397b88bb162675385373a0e010c79f/rollup/rollup_sync_service/rollup_sync_service.go)
records the finalized L2 head after validating batches; its
[L1 data reader](https://github.com/scroll-tech/go-ethereum/blob/c06c4243c1397b88bb162675385373a0e010c79f/rollup/da_syncer/da/calldata_blob_source.go)
limits observations to finalized L1 blocks. The application trusts its configured
RPC to report these values honestly; it does not independently verify proofs or
Ethereum consensus. The notice tracks the most recent transaction in the current
page session; it is not a persistent transaction history or operational monitor.
Local Anvil inclusion establishes no Ethereum finality.

## Rollout and rollback

These changes can run against the existing outage-capable local deployment.
No contract migration is needed. Keep the existing local contract address and
private recovery files. If reverting the UI/tooling, restore matching source and
lockfile from `97a8dc6`; preserve `.env.local` and chain state. Old and new games
stay attached to their original immutable contracts.

Release readiness still requires external contract/circuit review, a maintained
Scroll-native rehearsal environment, measured live fees/finality, operational
monitoring and ownership, and explicit approval of a concrete public release.
See [release gates](release.md). Internal checks do not establish mainnet readiness.
