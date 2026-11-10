import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  toHex,
  toRlp,
  type Address,
  type Hex,
} from "viem";

export const FEE_QUOTE_LIFETIME_MS = 30_000;
export const scrollOracle =
  "0x5300000000000000000000000000000000000002" as const;
const oracleAbi = parseAbi([
  "function getL1Fee(bytes data) view returns (uint256)",
]);
export const isScroll = (chainId: number) =>
  chainId === 534352 || chainId === 534351;
export type FeeCall = {
  chainId: number;
  account: Address;
  to: Address;
  data: Hex;
  value: bigint;
};
export type FeeQuote = {
  binding: Hex;
  observedAt: number;
  gasEstimate: bigint;
  gasLimit: bigint;
  gasPrice: bigint;
  executionFee: bigint;
  l1DataFee?: bigint;
};
export type FeeClient = {
  getChainId: () => Promise<number>;
  estimateGas: (args: {
    account: Address;
    to: Address;
    data: Hex;
    value: bigint;
  }) => Promise<bigint>;
  getGasPrice: () => Promise<bigint>;
  readContract: (args: {
    address: Address;
    abi: typeof oracleAbi;
    functionName: "getL1Fee";
    args: readonly [Hex];
  }) => Promise<unknown>;
};
export function feeBinding(call: FeeCall): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint256" },
      ],
      [
        BigInt(call.chainId),
        call.account,
        call.to,
        keccak256(call.data),
        call.value,
      ],
    ),
  );
}
// This app explicitly requests legacy transactions. Include the complete signed
// EIP-155 RLP envelope, not calldata alone. Use maximum-width uint64 nonce and
// 32-byte signature components; no signature is generated or requested here.
// All-nonzero bytes of that size also bound pre-Curie byte gas. The oracle only
// counts bytes/length; this synthetic buffer is never submitted as a transaction.
// Galileo's client caps compressed length at raw signed-RLP length:
// scroll-tech/go-ethereum c06c4243... rollup/fees/rollup_fee.go:197-219.
export function scrollRawSizeUpperBound(
  call: FeeCall,
  gasLimit: bigint,
  gasPrice: bigint,
): Hex {
  const scalar = (n: bigint): Hex => (n === 0n ? "0x" : toHex(n));
  const envelope = toRlp([
    `0x${"ff".repeat(8)}`,
    scalar(gasPrice),
    scalar(gasLimit),
    call.to,
    scalar(call.value),
    call.data,
    scalar(BigInt(call.chainId) * 2n + 36n),
    `0x${"ff".repeat(32)}`,
    `0x${"ff".repeat(32)}`,
  ]);
  return `0x${"ff".repeat((envelope.length - 2) / 2)}`;
}
export function quoteIsStale(quote: FeeQuote, now = Date.now()) {
  return (
    now < quote.observedAt || now - quote.observedAt >= FEE_QUOTE_LIFETIME_MS
  );
}
export function quoteIncreased(previous: FeeQuote, fresh: FeeQuote) {
  return (
    previous.binding !== fresh.binding ||
    fresh.executionFee > previous.executionFee ||
    (fresh.l1DataFee ?? 0n) > (previous.l1DataFee ?? 0n)
  );
}
export async function estimateFees(
  client: FeeClient,
  call: FeeCall,
): Promise<FeeQuote> {
  const observedAt = Date.now();
  if ((await client.getChainId()) !== call.chainId)
    throw new Error("Fee estimate unavailable.");
  const [gasEstimate, gasPrice] = await Promise.all([
    client.estimateGas({
      account: call.account,
      to: call.to,
      data: call.data,
      value: call.value,
    }),
    client.getGasPrice(),
  ]);
  if (
    typeof gasEstimate !== "bigint" ||
    gasEstimate <= 0n ||
    typeof gasPrice !== "bigint" ||
    gasPrice < 0n
  )
    throw new Error("Fee estimate unavailable.");
  // Keep a gas buffer for state changes between estimation and inclusion.
  const gasLimit = gasEstimate + gasEstimate / 4n + 5000n;
  let l1DataFee: bigint | undefined;
  if (isScroll(call.chainId)) {
    const result = await client.readContract({
      address: scrollOracle,
      abi: oracleAbi,
      functionName: "getL1Fee",
      args: [scrollRawSizeUpperBound(call, gasLimit, gasPrice)],
    });
    if (typeof result !== "bigint" || result < 0n)
      throw new Error("Fee estimate unavailable.");
    l1DataFee = result;
  }
  return {
    binding: feeBinding(call),
    observedAt,
    gasEstimate,
    gasLimit,
    gasPrice,
    executionFee: gasLimit * gasPrice,
    l1DataFee,
  };
}
