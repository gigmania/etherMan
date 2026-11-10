import type { Hex } from "viem";
import { isScroll } from "./fees";
export type Inclusion = { blockNumber: bigint; blockHash: Hex };
export type FinalityStatus =
  "checking" | "local" | "pending" | "finalized" | "unknown" | "reorg";
export type Finality = { status: FinalityStatus; message: string };
export type FinalityClient = {
  getChainId: () => Promise<number>;
  getBlock: (
    args: { blockNumber: bigint } | { blockTag: "finalized" },
  ) => Promise<{ hash: Hex | null; number: bigint | null }>;
};
export async function checkFinality(
  client: FinalityClient,
  chainId: number,
  receipt: Inclusion,
): Promise<Finality> {
  const unknown: Finality = {
    status: "unknown",
    message:
      "Finality unknown. The RPC could not verify canonical inclusion and finality; check the transaction before relying on it.",
  };
  const reorg: Finality = {
    status: "reorg",
    message:
      "Inclusion changed: the receipt block is no longer canonical. Refresh the game and check the transaction before trying again.",
  };
  try {
    if ((await client.getChainId()) !== chainId) return unknown;
    const canonical = await client.getBlock({
      blockNumber: receipt.blockNumber,
    });
    if (!canonical.hash || canonical.number !== receipt.blockNumber)
      return unknown;
    if (canonical.hash.toLowerCase() !== receipt.blockHash.toLowerCase())
      return reorg;
    if (chainId === 31337)
      return {
        status: "local",
        message:
          "Local inclusion only. This development chain has no Ethereum L1 finality.",
      };
    const finalized = await client.getBlock({ blockTag: "finalized" });
    if (!finalized.hash || finalized.number === null) return unknown;
    if (finalized.number < receipt.blockNumber)
      return {
        status: "pending",
        message:
          "Included, awaiting finality. You can continue playing while finality is checked.",
      };
    const finalizedCanonical = await client.getBlock({
      blockNumber: finalized.number,
    });
    if (
      finalizedCanonical.hash?.toLowerCase() !== finalized.hash.toLowerCase() ||
      finalizedCanonical.number !== finalized.number
    )
      return unknown;
    // Recheck the receipt block after the finalized lookup, guarding a reorg
    // between observations. RPC-reported finality is trusted, not a local proof.
    const recheck = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (!recheck.hash || recheck.number !== receipt.blockNumber) return unknown;
    if (recheck.hash.toLowerCase() !== receipt.blockHash.toLowerCase())
      return reorg;
    return {
      status: "finalized",
      message: isScroll(chainId)
        ? "The network RPC reports this Scroll inclusion as finalized on L1."
        : "The network RPC reports this inclusion as finalized on the selected network.",
    };
  } catch {
    return unknown;
  }
}
