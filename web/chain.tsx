import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWalletClient } from "wagmi";
import {
  encodeFunctionData,
  type Address,
  type Abi,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { etherManAbi } from "./generated/etherManAbi";
import {
  contractAddress,
  networkAllowed,
  publicClient,
  setupIssue,
  targetChain,
} from "./config";
import {
  unverifiedNetwork,
  unverifiedHealthMessage,
  type Game,
  type NetworkStatus,
} from "./domain";
import {
  estimateFees,
  quoteIncreased,
  quoteIsStale,
  type FeeQuote,
} from "./fees";
import { checkFinality, type Finality, type Inclusion } from "./finality";

export const abi: Abi = etherManAbi;
export const networkErrors = {
  SequencerUnavailable:
    "Network health is unavailable. Active game actions and timeout forfeitures are paused. Try again after the health check recovers.",
  SequencerDown:
    "The network sequencer is down. Active game actions and timeout forfeitures are paused until recovery.",
  RecoverySyncRequired:
    "Network recovery needs to be recorded. Any connected wallet can start the 24-hour recovery grace period.",
};
export class NetworkHealthError extends Error {}
async function readNetworkStatus(): Promise<NetworkStatus> {
  if (
    !contractAddress ||
    !networkAllowed ||
    (await publicClient.getChainId()) !== targetChain.id
  )
    throw new NetworkHealthError(unverifiedHealthMessage);
  const result = (await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: "getNetworkStatus",
  })) as readonly [number, bigint, bigint];
  if (
    !Array.isArray(result) ||
    result.length !== 3 ||
    ![0, 1, 2, 3].includes(result[0]) ||
    typeof result[1] !== "bigint" ||
    typeof result[2] !== "bigint" ||
    result[1] < 0n ||
    result[2] < 0n
  )
    throw new NetworkHealthError(unverifiedHealthMessage);
  return {
    status: result[0] as NetworkStatus["status"],
    roundId: result[1],
    recoveryUntil: result[2],
  };
}
export function useNetworkStatus() {
  const deployment = useDeployment();
  const query = useQuery({
    queryKey: ["network-status", targetChain.id, contractAddress],
    enabled: deployment.data === true,
    refetchInterval: 5000,
    retry: false,
    queryFn: readNetworkStatus,
  });
  // A failed refresh must never keep a previously healthy cached result active.
  return {
    ...query,
    data:
      deployment.data === true && !query.isError && !query.isPending
        ? (query.data ?? unverifiedNetwork)
        : unverifiedNetwork,
  };
}
export async function assertNetworkReady() {
  let network: NetworkStatus;
  try {
    network = await readNetworkStatus();
  } catch {
    throw new NetworkHealthError(unverifiedHealthMessage);
  }
  if (network.status !== 3)
    throw new NetworkHealthError(
      network.status === 1
        ? networkErrors.SequencerDown
        : network.status === 2
          ? networkErrors.RecoverySyncRequired
          : networkErrors.SequencerUnavailable,
    );
}
function networkRevertMessage(error: unknown): string | undefined {
  // Read only the decoded error identifier, never RPC messages or call arguments.
  let cause: unknown = error;
  for (
    let depth = 0;
    depth < 8 && cause && typeof cause === "object";
    depth++
  ) {
    const item = cause as { data?: { errorName?: unknown }; cause?: unknown };
    const name = item.data?.errorName;
    if (typeof name === "string" && Object.hasOwn(networkErrors, name))
      return networkErrors[name as keyof typeof networkErrors];
    cause = item.cause;
  }
}
export function useDeployment() {
  return useQuery({
    queryKey: ["deployment", targetChain.id, contractAddress],
    enabled: !!contractAddress && networkAllowed,
    staleTime: 30_000,
    queryFn: async () => {
      if ((await publicClient.getChainId()) !== targetChain.id)
        throw new Error("The RPC is connected to the wrong network.");
      const code = await publicClient.getCode({ address: contractAddress! });
      if (!code || code === "0x")
        throw new Error("No contract was found at the configured address.");
      await publicClient.readContract({
        address: contractAddress!,
        abi,
        functionName: "nextGameId",
      });
      return true;
    },
  });
}
// Dictionary support is creation-only: older games still need reveal/withdrawal.
async function readDictionaryRoot(): Promise<Hex> {
  if (
    !contractAddress ||
    !networkAllowed ||
    (await publicClient.getChainId()) !== targetChain.id
  )
    throw new Error("The dictionary deployment is not ready.");
  const root = (await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: "dictionaryRoot",
  })) as Hex;
  const verifier = (await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: "dictionaryVerifier",
  })) as Hex;
  if (!/^0x[0-9a-f]{64}$/i.test(root) || !/^0x[0-9a-f]{40}$/i.test(verifier))
    throw new Error("The dictionary deployment is not ready.");
  const code = await publicClient.getCode({ address: verifier });
  if (!code || code === "0x")
    throw new Error("The dictionary deployment is not ready.");
  return root;
}
export function useDictionaryRoot() {
  const deployment = useDeployment();
  return useQuery({
    queryKey: ["dictionary-root", targetChain.id, contractAddress],
    enabled: deployment.data === true,
    staleTime: 30_000,
    refetchInterval: 30_000,
    queryFn: readDictionaryRoot,
  });
}
export async function assertDictionaryDeployment(root: string) {
  if ((await readDictionaryRoot()).toLowerCase() !== root.toLowerCase())
    throw new Error(
      "The dictionary deployment changed. Reload before creating a game.",
    );
}
export function useGame(id?: bigint) {
  const deployment = useDeployment();
  return useQuery({
    queryKey: ["game", targetChain.id, contractAddress, id?.toString()],
    enabled: deployment.data === true && !!id,
    refetchInterval: 5000,
    queryFn: async () => {
      // A game transition between separate latest reads must not mix turns.
      const blockNumber = await publicClient.getBlockNumber({ cacheTime: 0 });
      const [game, guesses] = await Promise.all([
        publicClient.readContract({
          address: contractAddress!,
          abi,
          functionName: "getGame",
          args: [id!],
          blockNumber,
        }),
        publicClient.readContract({
          address: contractAddress!,
          abi,
          functionName: "getGuesses",
          args: [id!],
          blockNumber,
        }),
      ]);
      return {
        game: game as Game,
        guesses: guesses as readonly [readonly number[], readonly number[]],
      };
    },
  });
}
export function useGames(page: number) {
  const deployment = useDeployment();
  return useQuery({
    queryKey: ["games", targetChain.id, contractAddress, page],
    enabled: deployment.data === true,
    refetchInterval: 10000,
    queryFn: async () => {
      const next = (await publicClient.readContract({
        address: contractAddress!,
        abi,
        functionName: "nextGameId",
      })) as bigint;
      const newest = next - 1n - BigInt(page * 20);
      const ids = Array.from(
        { length: Number(newest < 20n ? (newest > 0n ? newest : 0n) : 20n) },
        (_, i) => newest - BigInt(i),
      );
      const games = await Promise.all(
        ids.map(async (id) => ({
          id,
          game: (await publicClient.readContract({
            address: contractAddress!,
            abi,
            functionName: "getGame",
            args: [id],
          })) as Game,
        })),
      );
      return { games, hasOlder: newest > 20n };
    },
  });
}
export function useCredits() {
  const { address } = useConnection();
  const deployment = useDeployment();
  return useQuery({
    queryKey: ["credits", targetChain.id, contractAddress, address],
    enabled: deployment.data === true && !!address,
    refetchInterval: 10000,
    queryFn: async () =>
      (await publicClient.readContract({
        address: contractAddress!,
        abi,
        functionName: "credits",
        args: [address!],
      })) as bigint,
  });
}
export type Action =
  | "createGame"
  | "joinGame"
  | "guess"
  | "respond"
  | "concede"
  | "reveal"
  | "cancelGame"
  | "claimTimeout"
  | "syncSequencer"
  | "withdrawTo";
type TransactionState = {
  phase:
    | "idle"
    | "simulating"
    | "review"
    | "signing"
    | "pending"
    | "included"
    | "cancelled"
    | "error";
  label?: string;
  message?: string;
  hash?: Hex;
  review?: {
    account: Address;
    contract: Address;
    chainId: number;
    value: bigint;
    quote?: FeeQuote;
    feeStatus: "ready" | "unavailable" | "refreshing";
  };
  inclusion?: Inclusion;
  finality?: Finality;
};
type ReviewDecision = "continue" | "refresh" | "cancel";
type TransactionContext = {
  state: TransactionState;
  busy: boolean;
  run: (
    label: string,
    action: Action,
    args: readonly unknown[],
    value?: bigint,
  ) => Promise<TransactionReceipt | undefined>;
  clear: () => void;
  reviewDecision: (decision: ReviewDecision) => void;
};
const Context = createContext<TransactionContext | null>(null);
// Only messages authored here are safe to show. RPC errors can include a
// reveal's word/salt in decoded arguments, even when their prefix looks familiar.
class ActionError extends Error {}
class ReviewCancelled extends Error {}
function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new ReviewCancelled());
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}
export function TransactionProvider({ children }: { children: ReactNode }) {
  const connection = useConnection();
  const wallet = useWalletClient();
  const deployment = useDeployment();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TransactionState>({ phase: "idle" });
  const active = useRef(false);
  const reviewChoice = useRef<((choice: ReviewDecision) => void) | undefined>(
    undefined,
  );
  const reviewCancellation = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const current = useRef(connection);
  current.current = connection;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reviewCancellation.current?.abort();
      reviewChoice.current?.("cancel");
      reviewChoice.current = undefined;
    };
  }, []);
  useEffect(() => {
    if (state.phase !== "included" || !state.inclusion || !state.hash) return;
    const inclusion = state.inclusion;
    const hash = state.hash;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const finality = await checkFinality(
        publicClient,
        targetChain.id,
        inclusion,
      );
      if (cancelled) return;
      setState((previous) =>
        previous.phase === "included" && previous.hash === hash
          ? {
              ...previous,
              finality,
              ...(finality.status === "reorg"
                ? { phase: "error", message: finality.message }
                : {}),
            }
          : previous,
      );
      if (finality.status === "reorg") {
        await queryClient.invalidateQueries({
          predicate: (query) =>
            ["game", "games", "credits", "network-status"].includes(
              String(query.queryKey[0]),
            ),
        });
      } else if (finality.status !== "finalized")
        timer = setTimeout(poll, 15_000);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state.phase, state.hash, state.inclusion, queryClient]);
  const run = useCallback(
    async (
      label: string,
      action: Action,
      args: readonly unknown[],
      value?: bigint,
    ) => {
      if (active.current) return;
      active.current = true;
      const reviewAbort = new AbortController();
      reviewCancellation.current = reviewAbort;
      let hash: Hex | undefined;
      let mined = false;
      let cancelled = false;
      try {
        // Snapshot all call arguments before any await/review. Never keep them
        // in UI state, storage or error text (reveals contain the secret).
        const callArgs = structuredClone(args);
        const account = current.current.address;
        if (
          setupIssue ||
          !networkAllowed ||
          !contractAddress ||
          !deployment.data
        )
          throw new ActionError(
            "The contract is not ready. Check the connection notice.",
          );
        if (
          !account ||
          !wallet.data ||
          current.current.chainId !== targetChain.id
        )
          throw new ActionError(
            `Connect your wallet to ${targetChain.name} first.`,
          );
        const verifyWallet = async () => {
          if (
            current.current.address?.toLowerCase() !== account.toLowerCase() ||
            current.current.chainId !== targetChain.id ||
            (await wallet.data!.getChainId()) !== targetChain.id ||
            (await wallet.data!.getAddresses())[0]?.toLowerCase() !==
              account.toLowerCase()
          )
            throw new ActionError(
              "Your wallet account or network changed. Review the action and try again.",
            );
        };
        await verifyWallet();
        if ((await publicClient.getChainId()) !== targetChain.id)
          throw new ActionError("The RPC is connected to the wrong network.");
        setState({
          phase: "simulating",
          label,
          message: "Checking the transaction before requesting a signature…",
        });
        // Capture the intended call independently of the wallet or replacement.
        const expectedInput = encodeFunctionData({
          abi,
          functionName: action,
          args: callArgs,
        });
        const simulate = () =>
          publicClient.simulateContract({
            address: contractAddress!,
            abi,
            functionName: action,
            args: callArgs,
            account,
            ...(value === undefined ? {} : { value }),
          });
        await simulate();
        await verifyWallet();
        const call = {
          chainId: targetChain.id,
          account,
          to: contractAddress,
          data: expectedInput,
          value: value ?? 0n,
        };
        const reviewBase = {
          account,
          contract: contractAddress,
          chainId: targetChain.id,
          value: value ?? 0n,
        };
        const getEstimate = async (): Promise<FeeQuote | undefined> => {
          setState({
            phase: "review",
            label,
            message: "Refreshing the fee estimate…",
            review: { ...reviewBase, feeStatus: "refreshing" },
          });
          try {
            return await cancellable(
              estimateFees(publicClient, call),
              reviewAbort.signal,
            );
          } catch {
            if (reviewAbort.signal.aborted) throw new ReviewCancelled();
            return undefined;
          }
        };
        let quote = await getEstimate();
        let reviewMessage =
          "Review the transaction value and estimated network fees before continuing.";
        for (;;) {
          if (!mounted.current || reviewAbort.signal.aborted)
            throw new ReviewCancelled();
          setState({
            phase: "review",
            label,
            message: !quote
              ? "Fee estimate unavailable. Refresh the estimate before continuing; no signature has been requested."
              : reviewMessage,
            review: {
              ...reviewBase,
              quote,
              feeStatus: quote ? "ready" : "unavailable",
            },
          });
          const choice = await cancellable(
            new Promise<ReviewDecision>((resolve) => {
              reviewChoice.current = resolve;
            }),
            reviewAbort.signal,
          );
          reviewChoice.current = undefined;
          if (choice === "cancel") throw new ReviewCancelled();
          await verifyWallet();
          if (choice === "refresh") {
            quote = await getEstimate();
            continue;
          }
          if (!quote || quoteIsStale(quote)) {
            reviewMessage =
              "Fee estimate is stale. Refresh the estimate before continuing.";
            continue;
          }
          await simulate();
          const fresh = await getEstimate();
          if (!fresh || quoteIncreased(quote, fresh) || quoteIsStale(fresh)) {
            quote = fresh;
            reviewMessage =
              "The fee estimate changed or expired. Review the refreshed amounts before continuing.";
            continue;
          }
          await verifyWallet();
          if ((await publicClient.getChainId()) !== targetChain.id)
            throw new ActionError("The RPC is connected to the wrong network.");
          if (reviewAbort.signal.aborted) throw new ReviewCancelled();
          if (quoteIsStale(fresh)) {
            quote = fresh;
            reviewMessage = "Fee estimate is stale. Refresh before continuing.";
            continue;
          }
          quote = fresh;
          break;
        }
        setState({
          phase: "signing",
          label,
          message: "Review the amount and network in your wallet.",
        });
        hash = await wallet.data.writeContract({
          address: contractAddress,
          abi,
          functionName: action,
          args: callArgs,
          value: value ?? 0n,
          type: "legacy",
          gas: quote.gasLimit,
          gasPrice: quote.gasPrice,
          chain: targetChain,
          account,
        });
        setState({
          phase: "pending",
          label,
          hash,
          message: "Submitted. Waiting for on-chain inclusion…",
        });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          timeout: 180_000,
          onReplaced: ({ reason, transactionReceipt }) => {
            hash = transactionReceipt.transactionHash;
            cancelled = reason === "cancelled";
            setState({
              phase: "pending",
              label,
              hash,
              message:
                "A replacement was mined. Verifying the action it executed…",
            });
          },
        });
        hash = receipt.transactionHash;
        mined = true;
        const transaction = await publicClient.getTransaction({ hash });
        if (
          cancelled ||
          transaction.from.toLowerCase() !== account.toLowerCase() ||
          transaction.to?.toLowerCase() !== contractAddress.toLowerCase() ||
          transaction.input.toLowerCase() !== expectedInput.toLowerCase() ||
          transaction.value !== (value ?? 0n)
        ) {
          throw new ActionError(
            "The transaction was replaced or cancelled. The requested action was not confirmed. Check the mined transaction before trying again.",
          );
        }
        if (receipt.status !== "success")
          throw new ActionError(
            "The transaction reverted. No game state was changed; network gas may still be charged.",
          );
        setState({
          phase: "included",
          label,
          hash,
          message: "Included on-chain",
          inclusion: {
            blockHash: receipt.blockHash,
            blockNumber: receipt.blockNumber,
          },
          finality: {
            status: "checking",
            message:
              "Checking canonical inclusion and finality. Inclusion alone is not finality.",
          },
        });
        return receipt;
      } catch (error) {
        if (error instanceof ReviewCancelled) {
          setState({
            phase: "cancelled",
            label,
            message:
              "Transaction cancelled. No signature was requested or transaction submitted.",
          });
          return undefined;
        }
        const text = error instanceof Error ? error.message : "";
        const known = error instanceof ActionError;
        const message =
          networkRevertMessage(error) ??
          (/reject|denied|4001/i.test(text)
            ? "Signature declined. No transaction was submitted."
            : known
              ? text
              : hash
                ? "Confirmation is taking longer than expected. Check the transaction before trying again."
                : /insufficient funds/i.test(text)
                  ? "Your wallet needs enough ETH for the stake and network gas."
                  : "The transaction could not be prepared or submitted. Refresh the game and check your wallet, network, and inputs.");
        setState({ phase: "error", label, hash, message });
        return undefined;
      } finally {
        // A replacement may have changed another game or balance even when the
        // requested action failed. Always refresh after a mined receipt.
        if (mined) {
          await queryClient.invalidateQueries({
            predicate: (query) =>
              ["game", "games", "credits", "network-status"].includes(
                String(query.queryKey[0]),
              ),
          });
        }
        active.current = false;
        reviewChoice.current = undefined;
        reviewCancellation.current = undefined;
      }
    },
    [deployment.data, wallet.data, queryClient],
  );
  const busy = ["simulating", "review", "signing", "pending"].includes(
    state.phase,
  );
  return (
    <Context.Provider
      value={{
        state,
        run,
        busy,
        clear: () => !active.current && setState({ phase: "idle" }),
        reviewDecision: (decision) => {
          if (decision === "cancel") reviewCancellation.current?.abort();
          const choose = reviewChoice.current;
          reviewChoice.current = undefined;
          choose?.(decision);
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useTransaction() {
  const context = useContext(Context);
  if (!context) throw new Error("Missing transaction provider");
  return context;
}
export function useClock() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  return now;
}
