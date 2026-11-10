import { hexToBytes, toHex } from "viem";
import type { Recovery } from "./domain";

import { DICTIONARY_DEPTH, MAX_WORD_LENGTH } from "./generated/dictionaryConfig.ts";
export { DICTIONARY_DEPTH };
const mask128 = (1n << 128n) - 1n;
export function dictionaryIndex(words: readonly string[], word: string) {
  let low = 0, high = words.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (words[mid] === word) return mid;
    if (words[mid] < word) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}
export function dictionaryPublicInputs(recovery: Recovery, root: string) {
  const chain = BigInt(recovery.chainId), commitment = BigInt(recovery.commitment);
  return [root, chain >> 128n, chain & mask128, BigInt(recovery.contract),
    BigInt(recovery.creator), BigInt(recovery.word.length), commitment >> 128n,
    commitment & mask128].map(value => toHex(BigInt(value), { size: 32 }));
}
export function dictionaryWitness(recovery: Recovery, words: readonly string[], tree: Uint8Array, root: string) {
  const index = dictionaryIndex(words, recovery.word);
  if (!/^[a-z]+$/.test(recovery.word) || recovery.word.length > MAX_WORD_LENGTH || index < 0) throw new Error("Word is not in this game's dictionary.");
  const capacity = 2 ** DICTIONARY_DEPTH;
  if (tree.length !== capacity * 64 || index >= capacity) throw new Error("Invalid dictionary tree.");
  const inputs = dictionaryPublicInputs(recovery, root);
  const siblings: string[] = [], directions: boolean[] = [];
  let cursor = capacity + index;
  for (let level = 0; level < DICTIONARY_DEPTH; level++) {
    const sibling = cursor ^ 1;
    siblings.push(toHex(tree.slice(sibling * 32, sibling * 32 + 32)));
    directions.push((cursor & 1) === 1);
    cursor >>= 1;
  }
  return {
    root: inputs[0], chain_hi: inputs[1], chain_lo: inputs[2], game_contract: inputs[3],
    creator: inputs[4], word_length: inputs[5], commitment_hi: inputs[6], commitment_lo: inputs[7],
    word: Array.from({ length: MAX_WORD_LENGTH }, (_, i) => String(recovery.word.charCodeAt(i) || 0)),
    salt: [...hexToBytes(recovery.salt)].map(String), siblings, directions,
  };
}
