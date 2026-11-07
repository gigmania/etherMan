import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Noir } from '@noir-lang/noir_js';
import { Barretenberg, BackendType, UltraHonkBackend } from '@aztec-foundation/bb.js';
import { encodeAbiParameters, keccak256, toHex } from 'viem';
import { dictionaryWitness, dictionaryPublicInputs } from '../web/proof-inputs.ts';
const program = JSON.parse(await readFile('artifacts/dictionary-circuit.json', 'utf8'));
const manifest = JSON.parse(await readFile('dictionary/tree-manifest.json', 'utf8'));
const words = (await readFile('dictionary/words.txt', 'utf8')).trimEnd().split('\n');
const tree = await readFile('public/zk/dictionary-tree.bin');
// Public, synthetic benchmark values; never a user's recovery material.
const recovery = { version: 1, chainId: 31337, contract: '0x1111111111111111111111111111111111111111', creator: '0x2222222222222222222222222222222222222222', word: 'ether', salt: '0x' + 'ab'.repeat(32) };
recovery.commitment = keccak256(encodeAbiParameters([{type:'uint256'}, {type:'address'}, {type:'address'}, {type:'string'}, {type:'bytes32'}], [31337n, recovery.contract, recovery.creator, recovery.word, recovery.salt]));
const noir = new Noir(program);
let t = performance.now();
const { witness } = await noir.execute(dictionaryWitness(recovery, words, tree, manifest.root));
const witnessMs = performance.now()-t;
console.log('Witness generated', Math.round(witnessMs), 'ms');
const bb = await Barretenberg.new({ backend: BackendType.Wasm, threads: 1 });
const backend = new UltraHonkBackend(program.bytecode, bb);
const options = { verifierTarget: 'evm' }; // Zero knowledge enabled; never evm-no-zk.
try {
  t = performance.now();
  const result = await backend.generateProof(witness, options);
  const proveMs = performance.now()-t;
  assert.deepEqual(result.publicInputs.map(x=>x.toLowerCase()), dictionaryPublicInputs(recovery, manifest.root));
  assert.equal(await backend.verifyProof(result, options), true);
  await writeFile('artifacts/dictionary-proof.json', JSON.stringify({ recovery, proof: toHex(result.proof), publicInputs: result.publicInputs }));
  const benchmark = { witnessMs, proveMs, proofBytes: result.proof.length, publicInputCount: result.publicInputs.length, peakRssKiB: process.resourceUsage().maxRSS, verified: true, backend: '@aztec-foundation/bb.js@6.0.0', noir: '1.0.0', threads: 1, verifierTarget: 'evm' };
  await writeFile('artifacts/dictionary-benchmark.json', JSON.stringify(benchmark, null, 2)+'\n');
  console.log(JSON.stringify(benchmark));
} finally { await bb.destroy(); }
