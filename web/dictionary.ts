import type { Hex } from "viem";
import type { Recovery } from "./domain";
import { dictionaryPublicInputs } from "./proof-inputs";
import {
  DictionaryError,
  dictionaryErrors,
  requireDictionaryRoot,
} from "./dictionary-assets";
export {
  checkDictionaryWord,
  dictionaryRoot,
  DictionaryError,
  dictionaryErrors,
} from "./dictionary-assets";

export type DictionaryProof = {
  proof: Hex;
  publicInputs: Hex[];
  timings: { witnessMs: number; proveMs: number; elapsedMs: number };
};
export type DictionaryProgress =
  "loading" | "witness" | "proving" | "verifying";
export function proveDictionaryWord(
  recovery: Recovery,
  root: string,
  signal: AbortSignal,
  progress: (phase: DictionaryProgress) => void = () => {},
): Promise<DictionaryProof> {
  requireDictionaryRoot(root);
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DictionaryError(dictionaryErrors.cancelled));
      return;
    }
    const worker = new Worker(
      new URL("./dictionary.worker.ts", import.meta.url),
      { type: "module" },
    );
    let settled = false;
    const finish = (error?: Error, result?: DictionaryProof) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new DictionaryError(dictionaryErrors.cancelled));
    const timer = setTimeout(
      () => finish(new DictionaryError(dictionaryErrors.proof)),
      180_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      finish(new DictionaryError(dictionaryErrors.proof));
    };
    worker.onmessageerror = () =>
      finish(new DictionaryError(dictionaryErrors.proof));
    worker.onmessage = (event) => {
      const data = event.data;
      if (
        data?.type === "progress" &&
        ["loading", "witness", "proving", "verifying"].includes(data.phase)
      ) {
        progress(data.phase);
      } else if (data?.type === "result") {
        const expected = dictionaryPublicInputs(recovery, root);
        const result = data.result as DictionaryProof;
        if (
          typeof result?.proof !== "string" ||
          !/^0x(?:[0-9a-f]{2})+$/i.test(result.proof) ||
          !Array.isArray(result.publicInputs) ||
          result.publicInputs.length !== expected.length ||
          result.publicInputs.some(
            (value, i) =>
              typeof value !== "string" ||
              value.toLowerCase() !== expected[i].toLowerCase(),
          )
        ) {
          finish(new DictionaryError(dictionaryErrors.proof));
          return;
        }
        finish(undefined, result);
      } else if (data?.type === "error") {
        finish(
          new DictionaryError(
            data.code === "word"
              ? dictionaryErrors.word
              : dictionaryErrors.proof,
          ),
        );
      }
    };
    worker.postMessage({ recovery, root });
  });
}
