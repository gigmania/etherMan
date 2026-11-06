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
import type { Game } from "./domain";

export const abi: Abi = etherManAbi;
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
  | "withdrawTo";
type TransactionState = {
  phase: "idle" | "simulating" | "signing" | "pending" | "success" | "error";
  label?: string;
  message?: string;
  hash?: Hex;
};
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
};
const Context = createContext<TransactionContext | null>(null);
// Only messages authored here are safe to show. RPC errors can include a
// reveal's word/salt in decoded arguments, even when their prefix looks familiar.
class ActionError extends Error {}
export function TransactionProvider({ children }: { children: ReactNode }) {
  const connection = useConnection();
  const wallet = useWalletClient();
  const deployment = useDeployment();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TransactionState>({ phase: "idle" });
  const active = useRef(false);
  const current = useRef(connection);
  current.current = connection;
  const run = useCallback(
    async (
      label: string,
      action: Action,
      args: readonly unknown[],
      value?: bigint,
    ) => {
      if (active.current) return;
      active.current = true;
      let hash: Hex | undefined;
      let mined = false;
      let cancelled = false;
      try {
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
          args,
        });
        const simulation = await publicClient.simulateContract({
          address: contractAddress,
          abi,
          functionName: action,
          args,
          account,
          ...(value === undefined ? {} : { value }),
        });
        await verifyWallet();
        setState({
          phase: "signing",
          label,
          message: "Review the amount and network in your wallet.",
        });
        hash = await wallet.data.writeContract({
          ...simulation.request,
          chain: targetChain,
          account,
        });
        setState({
          phase: "pending",
          label,
          hash,
          message: "Submitted. Waiting for an on-chain confirmation…",
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
          phase: "success",
          label,
          hash,
          message: "Confirmed on-chain. Your game state has been refreshed.",
        });
        return receipt;
      } catch (error) {
        const text = error instanceof Error ? error.message : "";
        const known = error instanceof ActionError;
        const message = /reject|denied|4001/i.test(text)
          ? "Signature declined. No transaction was submitted."
          : known
            ? text
            : hash
              ? "Confirmation is taking longer than expected. Check the transaction before trying again."
              : /insufficient funds/i.test(text)
                ? "Your wallet needs enough ETH for the stake and network gas."
                : "The transaction could not be prepared or submitted. Refresh the game and check your wallet, network, and inputs.";
        setState({ phase: "error", label, hash, message });
        return undefined;
      } finally {
        // A replacement may have changed another game or balance even when the
        // requested action failed. Always refresh after a mined receipt.
        if (mined) {
          await queryClient.invalidateQueries({
            predicate: (query) =>
              ["game", "games", "credits"].includes(String(query.queryKey[0])),
          });
        }
        active.current = false;
      }
    },
    [deployment.data, wallet.data, queryClient],
  );
  const busy = ["simulating", "signing", "pending"].includes(state.phase);
  return (
    <Context.Provider
      value={{
        state,
        run,
        busy,
        clear: () => !active.current && setState({ phase: "idle" }),
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
