import { expect, it, vi } from "vitest";
import { checkFinality, type FinalityClient } from "./finality";
import type { Hex } from "viem";
const receipt = { blockNumber: 88n, blockHash: `0x${"11".repeat(32)}` as Hex };
const other = `0x${"22".repeat(32)}` as Hex;
function client(chainId: number, finalizedNumber = 90n) {
  return {
    getChainId: vi.fn().mockResolvedValue(chainId),
    getBlock: vi
      .fn()
      .mockImplementation(async ({ blockNumber }) => ({
        number: blockNumber ?? finalizedNumber,
        hash: blockNumber === receipt.blockNumber ? receipt.blockHash : other,
      })),
  };
}
it("keeps local inclusion separate from Ethereum L1 finality", async () => {
  const rpc = client(31337);
  const result = await checkFinality(rpc, 31337, receipt);
  expect(result.status).toBe("local");
  expect(result.message).toContain("no Ethereum L1 finality");
  expect(rpc.getBlock).toHaveBeenCalledOnce();
});
it("reports inclusion as pending until the finalized head covers it", async () => {
  expect(
    (await checkFinality(client(534352, 87n), 534352, receipt)).status,
  ).toBe("pending");
  expect((await checkFinality(client(534352), 534352, receipt)).status).toBe(
    "finalized",
  );
});
it("labels Sepolia finality as RPC-reported selected-network finality", async () => {
  const result = await checkFinality(client(11155111), 11155111, receipt);
  expect(result.status).toBe("finalized");
  expect(result.message).toContain("network RPC");
  expect(result.message).not.toContain("on L1");
});
it("reports unknown on unsupported tags, RPC failure, and wrong networks", async () => {
  const rpc = client(534352);
  rpc.getBlock.mockRejectedValueOnce(new Error("private RPC payload"));
  expect((await checkFinality(rpc, 534352, receipt)).status).toBe("unknown");
  rpc.getBlock.mockImplementation(async ({ blockNumber }) => {
    if (blockNumber === undefined) throw new Error("unsupported finalized");
    return { hash: receipt.blockHash, number: receipt.blockNumber };
  });
  const result = await checkFinality(rpc, 534352, receipt);
  expect(result.status).toBe("unknown");
  expect(result.message).not.toContain("unsupported");
  expect((await checkFinality(rpc, 1, receipt)).status).toBe("unknown");
});
it("detects reorganization before and during a finality check", async () => {
  const rpc = client(534352);
  rpc.getBlock.mockResolvedValueOnce({
    hash: other,
    number: receipt.blockNumber,
  });
  expect((await checkFinality(rpc, 534352, receipt)).status).toBe("reorg");
  const responses = [
    { hash: receipt.blockHash, number: 88n },
    { hash: other, number: 90n },
    { hash: other, number: 90n },
    { hash: other, number: 88n },
  ];
  rpc.getBlock.mockImplementation(async () => responses.shift()!);
  expect((await checkFinality(rpc, 534352, receipt)).status).toBe("reorg");
});
it.each([88n, 90n])(
  "rejects inconsistent finalized/canonical RPC branches at height %s",
  async (height) => {
    const rpc: FinalityClient = {
      getChainId: async () => 534352,
      getBlock: async (args) =>
        "blockTag" in args
          ? { hash: other, number: height }
          : { hash: receipt.blockHash, number: args.blockNumber },
    };
    expect((await checkFinality(rpc, 534352, receipt)).status).toBe("unknown");
  },
);
