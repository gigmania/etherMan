import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Recovery } from "./domain";
import { dictionaryPublicInputs } from "./proof-inputs";
import { proverManifest } from "./generated/proverManifest";
import { proveDictionaryWord, dictionaryErrors } from "./dictionary";

const recovery: Recovery = {
  version: 1,
  chainId: 31337,
  contract: "0x1111111111111111111111111111111111111111",
  creator: "0x2222222222222222222222222222222222222222",
  word: "ether",
  salt: `0x${"ab".repeat(32)}`,
  commitment: `0x${"cd".repeat(32)}`,
};
class TestWorker {
  static instances: TestWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { preventDefault: () => void }) => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    TestWorker.instances.push(this);
  }
  send(data: unknown) {
    this.onmessage?.({ data });
  }
}
beforeEach(() => {
  TestWorker.instances = [];
  vi.stubGlobal("Worker", TestWorker);
});
afterEach(() => vi.unstubAllGlobals());
it("terminates the worker on cancellation and ignores late completion", async () => {
  const controller = new AbortController();
  const promise = proveDictionaryWord(
    recovery,
    proverManifest.root,
    controller.signal,
  );
  const failure = expect(promise).rejects.toThrow(dictionaryErrors.cancelled);
  const worker = TestWorker.instances[0];
  controller.abort();
  await failure;
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.send({
    type: "result",
    result: {
      proof: "0x1234",
      publicInputs: dictionaryPublicInputs(recovery, proverManifest.root),
    },
  });
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it("rejects proof output bound to different public inputs", async () => {
  const promise = proveDictionaryWord(
    recovery,
    proverManifest.root,
    new AbortController().signal,
  );
  const failure = expect(promise).rejects.toThrow(dictionaryErrors.proof);
  const inputs = dictionaryPublicInputs(recovery, proverManifest.root);
  inputs[4] = `0x${"00".repeat(32)}`;
  TestWorker.instances[0].send({
    type: "result",
    result: { proof: "0x1234", publicInputs: inputs },
  });
  await failure;
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
});
it("returns only exact-input proof results and terminates the worker", async () => {
  const progress = vi.fn();
  const promise = proveDictionaryWord(
    recovery,
    proverManifest.root,
    new AbortController().signal,
    progress,
  );
  const worker = TestWorker.instances[0];
  const result = {
    proof: "0x1234",
    publicInputs: dictionaryPublicInputs(recovery, proverManifest.root),
    timings: { witnessMs: 1, proveMs: 2, elapsedMs: 3 },
  };
  worker.send({ type: "progress", phase: "proving" });
  worker.send({ type: "result", result });
  expect(await promise).toEqual(result);
  expect(progress).toHaveBeenCalledWith("proving");
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it("sanitizes worker errors and suppresses their default logging", async () => {
  const promise = proveDictionaryWord(
    recovery,
    proverManifest.root,
    new AbortController().signal,
  );
  const failure = expect(promise).rejects.toThrow(dictionaryErrors.proof);
  const preventDefault = vi.fn();
  TestWorker.instances[0].onerror?.({ preventDefault });
  await failure;
  expect(preventDefault).toHaveBeenCalledOnce();
});
it("does not create a worker for a cancelled request or wrong deployment root", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    proveDictionaryWord(recovery, proverManifest.root, controller.signal),
  ).rejects.toThrow(dictionaryErrors.cancelled);
  expect(() =>
    proveDictionaryWord(
      recovery,
      `0x${"00".repeat(32)}`,
      new AbortController().signal,
    ),
  ).toThrow("different dictionary");
  expect(TestWorker.instances).toHaveLength(0);
});
