import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BarretenbergSync, BackendType } from '@aztec-foundation/bb.js';
const source = JSON.parse(await readFile('dictionary/manifest.json', 'utf8'));
const bytes = await readFile('dictionary/words.txt');
const sha256 = value => createHash('sha256').update(value).digest('hex');
if (sha256(bytes) !== source.normalized.sha256) throw new Error('Dictionary source hash mismatch');
const words = bytes.toString().trimEnd().split('\n');
const maxWordLength = words.reduce((maximum, word) => Math.max(maximum, word.length), 0);
const depth = Math.ceil(Math.log2(words.length)), capacity = 2 ** depth;
// One BN254 field packs the word; the ABI preimage reserves one 32-byte slot.
// Fail explicitly if a future vocabulary needs a new encoding/mask design.
if (maxWordLength > 31 || !words.every(word => /^[a-z]+$/.test(word))) throw new Error('Dictionary encoding capacity exceeded');
if (maxWordLength !== source.normalized.maximumLength) throw new Error('Dictionary length metadata mismatch');
if (words.length !== source.normalized.wordCount || words.length > capacity) throw new Error('Dictionary count mismatch');
const tree = Buffer.alloc(capacity * 2 * 32);
const field = value => Uint8Array.from(Buffer.from(BigInt(value).toString(16).padStart(64, '0'), 'hex'));
const bb = await BarretenbergSync.new({ backend: BackendType.Wasm, skipSrsInit: true });
try {
  const hash = inputs => Buffer.from(bb.poseidon2Hash({ inputs }).hash);
  const leafTag = field(1), nodeTag = field(2), zero = field(0);
  const empty = hash([leafTag, zero, zero]);
  for (let i = 0; i < capacity; i++) {
    const word = words[i];
    const leaf = word ? hash([leafTag, field(word.length), field(BigInt('0x' + Buffer.from(word).toString('hex').padEnd(maxWordLength * 2, '0')))]) : empty;
    leaf.copy(tree, (capacity + i) * 32);
  }
  for (let i = capacity - 1; i >= 1; i--) {
    hash([nodeTag, tree.subarray(i * 64, i * 64 + 32), tree.subarray(i * 64 + 32, i * 64 + 64)]).copy(tree, i * 32);
  }
  const manifest = {
    dictionaryId: source.dictionaryId, depth, maxWordLength, wordCount: words.length,
    root: '0x' + tree.subarray(32, 64).toString('hex'),
    wordsSha256: sha256(bytes), treeSha256: sha256(tree),
    hash: `Barretenberg Poseidon2 BN254 sponge; leaf H(1,length,word${maxWordLength * 8}be); node H(2,left,right)`,
    layout: `32-byte big-endian fields; binary heap root at index 1, leaves at 2^${depth}; absent leaves H(1,0,0)`,
  };
  await mkdir('web/generated', { recursive: true });
  await writeFile('web/generated/dictionaryConfig.ts', `// Generated from the pinned dictionary. Do not edit.\nexport const DICTIONARY_DEPTH = ${depth};\nexport const MAX_WORD_LENGTH = ${maxWordLength};\n`);
  await writeFile('circuits/dictionary/src/config.nr', `// Generated from the pinned dictionary. Do not edit.\npub global MAX_WORD_LENGTH: u32 = ${maxWordLength};\npub global DICTIONARY_DEPTH: u32 = ${depth};\n`);
  await mkdir('public/zk/licenses', { recursive: true });
  await copyFile('dictionary/licenses/word-list-MIT.txt', 'public/zk/licenses/word-list-MIT.txt');
  await copyFile('dictionary/licenses/Letterpress-CC0-1.0.txt', 'public/zk/licenses/Letterpress-CC0-1.0.txt');
  await writeFile('public/zk/dictionary-tree.bin', tree);
  await copyFile('dictionary/words.txt', 'public/zk/dictionary.txt');
  await writeFile('public/zk/dictionary-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  await writeFile('dictionary/tree-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ words: words.length, depth, root: manifest.root, treeBytes: tree.length }));
} finally { await bb.destroy(); }
