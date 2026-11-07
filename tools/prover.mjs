import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Noir } from '@noir-lang/noir_js';
import { Barretenberg, BackendType, UltraHonkBackend } from '@aztec-foundation/bb.js';
import { toHex } from 'viem';
import { dictionaryWitness, dictionaryPublicInputs } from '../web/proof-inputs.ts';
export async function createProver() {
  const manifest = JSON.parse(await readFile('dictionary/prover-manifest.json', 'utf8'));
  const [circuitBytes, wordBytes, tree] = await Promise.all([
    readFile('public/zk/dictionary-circuit.json'), readFile('public/zk/dictionary.txt'), readFile('public/zk/dictionary-tree.bin'),
  ]);
  const sha256 = x => createHash('sha256').update(x).digest('hex');
  assert.equal(sha256(circuitBytes), manifest.circuitSha256);
  assert.equal(sha256(wordBytes), manifest.wordsSha256);
  assert.equal(sha256(tree), manifest.treeSha256);
  const program = JSON.parse(circuitBytes);
  const words = wordBytes.toString().trimEnd().split('\n');
  const noir = new Noir(program);
  const bb = await Barretenberg.new({ backend: BackendType.Wasm, threads: 1 });
  const backend = new UltraHonkBackend(program.bytecode, bb);
  const options = { verifierTarget: 'evm' };
  return {
    manifest, words, tree, noir, backend, options,
    async prove(recovery) {
      const { witness } = await noir.execute(dictionaryWitness(recovery, words, tree, manifest.root));
      const result = await backend.generateProof(witness, options);
      assert.deepEqual(result.publicInputs.map(x=>x.toLowerCase()), dictionaryPublicInputs(recovery, manifest.root));
      assert.equal(await backend.verifyProof(result, options), true);
      return { proof: toHex(result.proof), publicInputs: result.publicInputs };
    },
    destroy: () => bb.destroy(),
  };
}
