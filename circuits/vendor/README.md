# Vendored Noir dependencies

These libraries are pinned source snapshots; compilation does not fetch a moving
branch. Their source and LICENSE files are retained. Non-library packaging,
release automation, and upstream CI files are omitted.

- `keccak256`: https://github.com/noir-lang/keccak256 at
  `7b1894dd57c0c3d137ebc8d7d597151e372930c4` (Apache-2.0).
  The three test-only `mod` declarations at the top of `src/keccak256.nr` are
  omitted because Noir WASM 1.0.0 resolves those nested module paths incorrectly.
  Production hashing code is unchanged; upstream test sources remain present.
- `poseidon`: https://github.com/noir-lang/poseidon at
  `37a3a201eff8187760e909384d5881ed4a0a086c` (Apache-2.0).
  Library source is unchanged.

Circuit hashing is Keccak-256 (not SHA3-256) for the existing ABI commitment and
Barretenberg-compatible Poseidon2 over BN254 for private dictionary membership.
Both are checked through actual witness/proof generation and Solidity verification.
