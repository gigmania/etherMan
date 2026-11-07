import { Noir } from "@noir-lang/noir_js";
import {
  Barretenberg,
  BackendType,
  UltraHonkBackend,
} from "@aztec-foundation/bb.js";
import { toHex } from "viem";
import type { Recovery } from "./domain";
import { dictionaryWitness, dictionaryPublicInputs } from "./proof-inputs";
import {
  dictionaryAsset,
  loadDictionaryWords,
  requireDictionaryRoot,
} from "./dictionary-assets";
import { proverManifest } from "./generated/proverManifest";

let started = false;
self.onmessage = async (
  event: MessageEvent<{ recovery: Recovery; root: string }>,
) => {
  if (started) return;
  started = true;
  let bb: Barretenberg | undefined;
  let witness: Uint8Array | undefined;
  const begin = performance.now();
  const progress = (phase: string) =>
    self.postMessage({ type: "progress", phase });
  try {
    const { recovery, root } = event.data;
    requireDictionaryRoot(root);
    progress("loading");
    const [words, tree, circuitBytes] = await Promise.all([
      loadDictionaryWords(root),
      dictionaryAsset("dictionary-tree.bin", proverManifest.treeSha256),
      dictionaryAsset("dictionary-circuit.json", proverManifest.circuitSha256),
    ]);
    const circuit = JSON.parse(new TextDecoder().decode(circuitBytes));
    const inputs = dictionaryWitness(recovery, words, tree, root);
    progress("witness");
    let start = performance.now();
    ({ witness } = await new Noir(circuit).execute(inputs, async () => {
      throw new Error("Unexpected foreign call");
    }));
    const witnessMs = performance.now() - start;
    // A dedicated application worker owns the WASM instance. No witness leaves it.
    bb = await Barretenberg.new({ backend: BackendType.Wasm, threads: 1 });
    const backend = new UltraHonkBackend(circuit.bytecode, bb);
    progress("proving");
    start = performance.now();
    const proof = await backend.generateProof(witness, {
      verifierTarget: "evm",
    });
    const proveMs = performance.now() - start;
    progress("verifying");
    const expected = dictionaryPublicInputs(recovery, root);
    if (
      proof.publicInputs.length !== expected.length ||
      proof.publicInputs.some(
        (v, i) => v.toLowerCase() !== expected[i].toLowerCase(),
      ) ||
      !(await backend.verifyProof(proof, { verifierTarget: "evm" }))
    )
      throw new Error("Invalid proof");
    self.postMessage({
      type: "result",
      result: {
        proof: toHex(proof.proof),
        publicInputs: proof.publicInputs,
        timings: { witnessMs, proveMs, elapsedMs: performance.now() - begin },
      },
    });
  } catch {
    // Library errors may contain witness values. Send only an authored error code.
    self.postMessage({ type: "error", code: "proof" });
  } finally {
    witness?.fill(0);
    await bb?.destroy();
  }
};
