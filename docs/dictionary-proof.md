# Private dictionary enforcement

User approved this workstream on November 7, 2026: a licensed versioned dictionary,
private membership proof at creation, browser benchmarks, contract/UI integration,
negative/replay tests, and independent security review. Public deployment, mainnet
signing, changing the 24-hour timeout protocol, and external audit are excluded.
This is a high-risk cryptographic change under the engineering-team workflow.

## Acceptance criteria

- Creating a game requires proof of an allowed lowercase dictionary word, without
  revealing the word, salt, dictionary leaf, path, or index before ordinary reveal.
- The proof is bound to the chain, game contract, creator, word length, existing
  Keccak commitment, and immutable dictionary root. Callers cannot supply their
  own public inputs or choose a verifier.
- Invalid proofs cannot create games or consume deposits/commitments. A successfully
  used commitment cannot be reused after cancellation or settlement.
- Browser input changes, wallet changes, cancellation, and stale worker completion
  cannot submit a proof for a different creation attempt. Recovery stays usable.
- Real proofs verify in the generated Solidity verifier and complete all game
  flows; mocked-verifier unit tests alone are insufficient evidence.

## Frozen vocabulary and circuit

`dictionary/manifest.json` identifies word-list 4.1.0 and its upstream Letterpress
source, licenses, normalization, and hashes. There are 274,137 words. This is a
specific game vocabulary, with regional spellings and obscure inflections;
absence does not prove a word is not English. MIT and CC0 notices are retained
and copied into the browser assets. No vocabulary server/oracle is consulted.

The depth-19 tree has 524,288 leaves. A word is packed big-endian into twenty-eight
bytes, zero-padded on the right. Leaves use Poseidon2 H(1,length,packedWord224),
internal nodes H(2,left,right), and missing leaves H(1,0,0). The circuit constrains
length, ASCII range, zero padding, and every direction bit. The exact root and
binary tree hash are in `dictionary/tree-manifest.json`. There is no root setter;
changing the dictionary requires a new deployment.

Public inputs, in order: root, chain high 128 bits, chain low 128 bits, contract
address, creator address, length, commitment high 128 bits, commitment low 128
bits. The circuit range-checks the limbs and addresses rather than reducing a
256-bit value modulo the field. The contract constructs these eight inputs.
The existing commitment remains Keccak-256 of the exact 224-byte Solidity
`abi.encode(chainId,contract,creator,word,salt)` representation. Recovery v1 and
reveal encoding stay unchanged.

The source dictionary now determines capacity: all 274,137 lowercase entries
are included, ranging from 2 to 28 letters. Generated Noir, TypeScript and
Solidity constants agree on capacity. The build derives proof size by generating
and verifying a synthetic longest-word proof with the exact pinned backend.
The 224-byte Keccak ABI encoding is unchanged. uint32 masks cover all positions.

## Proving and deployment trust

Pinned compiler/runtime: Noir 1.0.0; backend: @aztec-foundation/bb.js 6.0.0.
The backend option is `verifierTarget: 'evm'`, which enables zero knowledge.
`evm-no-zk` and legacy `keccak: true` must never be substituted. Circuit library
commits and the small build adaptation are recorded in `circuits/vendor/README.md`.

Barretenberg uses a universal structured reference string (CRS/SRS); security
still relies on the proving system, compiler, cryptographic assumptions and setup.
The initial CRS download is from the backend's fixed public CDN URLs, cached by
its library. This implementation does not independently audit that ceremony or
pin/verify the entire upstream CRS. Browser requests download public assets; no
word, salt or witness is uploaded. Real inputs remain in worker memory, and
terminating the worker discards that context; JavaScript cannot promise physical
memory erasure.

The trusted build manifest pins circuit, dictionary, tree, verification key and
verifier-source identities. Generated verifier bytecode has two external library
links: ZKTranscriptLib and RelationsLib. `deploy-bundle.mjs` deploys those, then
HonkVerifier, then EtherMan with the frozen root. Its transaction client must be
loopback Anvil chain 31337. Deployment configuration remains a trust boundary:
constructor checks cannot establish that an arbitrary supplied verifier is honest.
A release must verify generated source, linked addresses, immutables, and bytecode.
There is no mock-verifier option in the deployment helpers.

## Benchmarks and limits

Historical v1 measurements on this development machine, single-threaded WASM
(the v2 results are recorded in `verification.md`):

| Measurement | Result |
| --- | --- |
| Node witness | about 62 ms |
| Node proving | about 1.81 s |
| Node peak process RSS | 408,480 KiB (includes runtime and initialization) |
| Chromium witness/proving | about 80 ms / 1.86 s |
| Chromium cold end-to-end worker run | about 11.06 s including loading/CRS |
| Proof size | 8,768 bytes plus eight public inputs |
| Standalone verifier transaction estimate | 3,841,148 gas on Anvil |
| Actual valid game creation | 4,008,996 gas on Anvil |
| Verifier runtime | 18,578 bytes, plus linked libraries |
| Dictionary/tree downloads | 2.3 MB text + 16 MiB binary, before transfer compression |

These are single development-machine samples, not latency guarantees, mobile
benchmarks, native Scroll gas measurements or fee quotes. Scroll data charges,
proving/execution compatibility and transaction limits still require validation.
The browser downloads the complete dictionary/tree at fixed URLs, avoiding
word-dependent path requests. Proving code is loaded only for creation.

## Verification and rollback

`npm run proof:build` regenerates assets; `npm run test:proof` checks real proofs,
all eight public-input mutations, malformed/copy attacks, atomic failure,
replays, range/padding/path failures and word-length boundaries. The ordinary
and Scroll-fork integration suites use the actual verifier for complete games.
Foundry mocks isolate state-machine and boundary tests. Browser tests cover
proof generation and creation plus stale/cancelled attempts.

Local rollout needs a fresh deployment/address and updated `.env.local`. Old
recovery files retain their encoding; only new creation uses membership checks.
Because the response selector widened from uint16 to uint32, old contracts must
retain their previous UI/ABI and deployment configuration (v1: `23f32a3`). Rollback is restoring the earlier candidate and its deployment
configuration, not migrating or modifying existing on-chain funds. Generated
artifacts must be rebuilt together; mixing a circuit, VK, verifier or manifest
from different versions should fail closed.

Independent agent review findings and convergence will be recorded in the
verification record. External cryptographic audit, native Scroll rehearsal,
outage-safe deadlines and mainnet release approval remain separate gates.
