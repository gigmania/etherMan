import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { proverManifest } from "./generated/proverManifest";
const words = await readFile("dictionary/words.txt");
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());
it("checks dictionary membership locally after one whole-list download", async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(words));
  vi.stubGlobal("fetch", fetcher);
  const { checkDictionaryWord } = await import("./dictionary-assets");
  await checkDictionaryWord("ether", proverManifest.root);
  await checkDictionaryWord("cat", proverManifest.root);
  await checkDictionaryWord("ab", proverManifest.root);
  await checkDictionaryWord(
    "ethylenediaminetetraacetates",
    proverManifest.root,
  );
  await expect(
    checkDictionaryWord("a".repeat(29), proverManifest.root),
  ).rejects.toThrow("game's English dictionary");
  await expect(
    checkDictionaryWord("zzzzzzzz", proverManifest.root),
  ).rejects.toThrow("game's English dictionary");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(String(fetcher.mock.calls[0][0])).toMatch(/\/zk\/dictionary\.txt$/);
});
it("rejects a modified dictionary asset before membership lookup", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("ether\nzzzzzzzz\n")),
  );
  const { checkDictionaryWord } = await import("./dictionary-assets");
  await expect(
    checkDictionaryWord("ether", proverManifest.root),
  ).rejects.toThrow("could not be verified");
});
