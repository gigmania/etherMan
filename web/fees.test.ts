import { describe, expect, it, vi } from "vitest";
import { parseTransaction, serializeTransaction, type Hex } from "viem";
import {
  estimateFees,
  feeBinding,
  quoteIncreased,
  quoteIsStale,
  scrollRawSizeUpperBound,
  type FeeCall,
} from "./fees";
const call: FeeCall = {
  chainId: 534352,
  account: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  data: "0x001122",
  value: 123n,
};
function client(chainId = call.chainId) {
  return {
    getChainId: vi.fn().mockResolvedValue(chainId),
    estimateGas: vi.fn().mockResolvedValue(100_000n),
    getGasPrice: vi.fn().mockResolvedValue(10n),
    readContract: vi.fn().mockResolvedValue(99n),
  };
}
describe("fee estimates", () => {
  it.each([534352, 534351])(
    "separates execution gas and a Scroll %s oracle upper bound from transaction value",
    async (chainId) => {
      const rpc = client(chainId);
      const quote = await estimateFees(rpc, { ...call, chainId });
      expect(quote.executionFee).toBe(1_300_000n);
      expect(quote.l1DataFee).toBe(99n);
      expect(rpc.estimateGas).toHaveBeenCalledWith({
        account: call.account,
        to: call.to,
        data: call.data,
        value: call.value,
      });
      const oracleRead = rpc.readContract.mock.calls[0][0];
      expect(oracleRead.address).toBe(
        "0x5300000000000000000000000000000000000002",
      );
      expect(oracleRead.functionName).toBe("getL1Fee");
      expect(oracleRead.args[0].length).toBeGreaterThan(
        call.data.length + 2 * 65,
      );
      expect(oracleRead.args[0]).not.toContain("001122");
    },
  );
  it.each([31337, 11155111])(
    "does not invent an L1 data charge on chain %s",
    async (chainId) => {
      const rpc = client(chainId);
      const quote = await estimateFees(rpc, { ...call, chainId });
      expect(quote.l1DataFee).toBeUndefined();
      expect(rpc.readContract).not.toHaveBeenCalled();
    },
  );
  it("bounds complete signed legacy transactions across nonce and signature lengths", () => {
    for (const data of ["0x", "0x00", `0x${"a0".repeat(9000)}`] as Hex[]) {
      const bound = scrollRawSizeUpperBound({ ...call, data }, 130000n, 10n);
      for (const nonce of [0, 127, 128, 65536, Number.MAX_SAFE_INTEGER]) {
        const signed = serializeTransaction(
          {
            type: "legacy",
            chainId: call.chainId,
            nonce,
            to: call.to,
            value: call.value,
            gas: 130000n,
            gasPrice: 10n,
            data,
          },
          {
            v: BigInt(call.chainId) * 2n + 36n,
            r: `0x${"11".repeat(32)}`,
            s: `0x${"22".repeat(32)}`,
          },
        );
        expect(bound.length).toBeGreaterThanOrEqual(signed.length);
        expect(parseTransaction(signed).data ?? "0x").toBe(data);
      }
    }
  });
  it("binds estimates to account, chain, target, calldata, and value", () => {
    for (const changed of [
      { account: call.to },
      { chainId: 31337 },
      { to: call.account },
      { data: "0xab" as Hex },
      { value: 124n },
    ])
      expect(feeBinding({ ...call, ...changed })).not.toBe(feeBinding(call));
  });
  it("expires at 30 seconds and requires review of increased components", async () => {
    const quote = await estimateFees(client(), call);
    expect(quoteIsStale(quote, quote.observedAt + 29999)).toBe(false);
    expect(quoteIsStale(quote, quote.observedAt + 30000)).toBe(true);
    expect(quoteIsStale(quote, quote.observedAt - 1)).toBe(true);
    expect(quoteIncreased(quote, { ...quote, l1DataFee: 100n })).toBe(true);
    expect(
      quoteIncreased(quote, {
        ...quote,
        executionFee: quote.executionFee + 1n,
      }),
    ).toBe(true);
    expect(
      quoteIncreased(quote, {
        ...quote,
        executionFee: quote.executionFee - 1n,
      }),
    ).toBe(false);
  });
  it("fails closed when the oracle, gas estimate, or network check fails", async () => {
    const rpc = client();
    rpc.readContract.mockRejectedValueOnce(new Error("oracle failure"));
    await expect(estimateFees(rpc, call)).rejects.toThrow();
    rpc.estimateGas.mockRejectedValueOnce(new Error("RPC failure"));
    await expect(estimateFees(rpc, call)).rejects.toThrow();
    rpc.getChainId.mockResolvedValue(1);
    await expect(estimateFees(rpc, call)).rejects.toThrow();
  });
});
