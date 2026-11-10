import type { Hex } from "viem";
import { dictionaryIndex } from "./proof-inputs";
import { proverManifest } from "./generated/proverManifest";

export const dictionaryRoot = proverManifest.root as Hex;
export const dictionaryErrors = {
  word: "Choose a word from this game's English dictionary.",
  assets:
    "The dictionary proof files could not be verified. Reload and try again.",
  proof:
    "The private word proof could not be generated. Your saved recovery file is still valid. Try again on a supported desktop browser.",
  cancelled: "Proof generation cancelled. No transaction was submitted.",
} as const;
export class DictionaryError extends Error {}
export function requireDictionaryRoot(root: string) {
  if (root.toLowerCase() !== dictionaryRoot.toLowerCase())
    throw new DictionaryError(
      "This deployment uses a different dictionary. Use the matching application build.",
    );
}
export async function dictionaryAsset(name: string, sha256: string) {
  const url = new URL(
    `${import.meta.env.BASE_URL}zk/${name}`,
    self.location.origin,
  );
  const response = await fetch(url, { credentials: "omit", redirect: "error" });
  if (!response.ok) throw new DictionaryError(dictionaryErrors.assets);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hex !== sha256) throw new DictionaryError(dictionaryErrors.assets);
  return bytes;
}
let wordsPromise: Promise<string[]> | undefined;
export function loadDictionaryWords(root: string): Promise<string[]> {
  requireDictionaryRoot(root);
  wordsPromise ??= dictionaryAsset("dictionary.txt", proverManifest.wordsSha256)
    .then((bytes) =>
      new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .trimEnd()
        .split("\n"),
    )
    .catch(() => {
      wordsPromise = undefined;
      throw new DictionaryError(dictionaryErrors.assets);
    });
  return wordsPromise;
}
export async function checkDictionaryWord(word: string, root: string) {
  const words = await loadDictionaryWords(root);
  if (!/^[a-z]+$/.test(word) || dictionaryIndex(words, word) < 0)
    throw new DictionaryError(dictionaryErrors.word);
}
