import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { encodeFunctionData, type Hex } from "viem";
import { etherManAbi } from "./generated/etherManAbi";

const mocks = vi.hoisted(() => ({
  account: "0x1111111111111111111111111111111111111111",
  contract: "0x2222222222222222222222222222222222222222",
  originalHash: `0x${"11".repeat(32)}`,
  replacementHash: `0x${"22".repeat(32)}`,
  args: [7n],
  publicClient: {
    getChainId: vi.fn(),
    getCode: vi.fn(),
    readContract: vi.fn(),
    getBlockNumber: vi.fn(),
    getBlock: vi.fn(),
    estimateGas: vi.fn(),
    getGasPrice: vi.fn(),
    simulateContract: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
    getTransaction: vi.fn(),
  },
  wallet: {
    getChainId: vi.fn(),
    getAddresses: vi.fn(),
    writeContract: vi.fn(),
  },
}));
vi.mock("./config", () => ({
  contractAddress: mocks.contract,
  networkAllowed: true,
  setupIssue: undefined,
  targetChain: { id: 31337, name: "Local test chain" },
  publicClient: mocks.publicClient,
}));
vi.mock("wagmi", () => ({
  useConnection: () => ({
    address: mocks.account,
    chainId: 31337,
    isConnected: true,
  }),
  useWalletClient: () => ({ data: mocks.wallet }),
}));
import {
  TransactionProvider,
  assertDictionaryDeployment,
  assertNetworkReady,
  useNetworkStatus,
  useDeployment,
  useGame,
  useTransaction,
} from "./chain";

const expectedInput = encodeFunctionData({
  abi: etherManAbi,
  functionName: "joinGame",
  args: [7n],
});
const intended = () => ({
  from: mocks.account,
  to: mocks.contract,
  input: expectedInput,
  value: 123n,
});
function Harness({ complete }: { complete: (result: unknown) => void }) {
  const tx = useTransaction();
  const deployment = useDeployment();
  return (
    <>
      <button
        disabled={!deployment.data}
        onClick={async () =>
          complete(await tx.run("Join game", "joinGame", mocks.args, 123n))
        }
      >
        Submit
      </button>
      <output data-testid="phase">{tx.state.phase}</output>
      <output data-testid="hash">{tx.state.hash}</output>
      <output data-testid="message">{tx.state.message}</output>
      <output data-testid="finality">{tx.state.finality?.status}</output>
      <output data-testid="fee-status">{tx.state.review?.feeStatus}</output>
      {tx.state.phase === "review" && (
        <>
          <button
            disabled={tx.state.review?.feeStatus !== "ready"}
            onClick={() => tx.reviewDecision("continue")}
          >
            Continue to wallet
          </button>
          <button onClick={() => tx.reviewDecision("refresh")}>
            Refresh estimate
          </button>
          <button onClick={() => tx.reviewDecision("cancel")}>
            Cancel transaction
          </button>
        </>
      )}
    </>
  );
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const complete = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <TransactionProvider>
        <Harness complete={complete} />
      </TransactionProvider>
    </QueryClientProvider>,
  );
  return { complete, invalidate };
}
async function submit(autoReview = true) {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  await waitFor(() =>
    expect(["review", "error"]).toContain(
      screen.getByTestId("phase").textContent,
    ),
  );
  if (autoReview && screen.getByTestId("phase").textContent === "review") {
    await waitFor(() =>
      expect(screen.getByTestId("fee-status").textContent).toBe("ready"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
  }
}
function receipt(hash = mocks.originalHash, status = "success") {
  return {
    transactionHash: hash,
    status,
    logs: [],
    blockNumber: 88n,
    blockHash: `0x${"33".repeat(32)}`,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.args = [7n];
  mocks.publicClient.getChainId.mockResolvedValue(31337);
  mocks.publicClient.getCode.mockResolvedValue("0x6000");
  mocks.publicClient.readContract.mockResolvedValue(1n);
  mocks.publicClient.getBlockNumber.mockResolvedValue(88n);
  mocks.publicClient.getBlock.mockResolvedValue({
    hash: receipt().blockHash,
    number: 88n,
  });
  mocks.publicClient.estimateGas.mockReset().mockResolvedValue(100_000n);
  mocks.publicClient.getGasPrice.mockReset().mockResolvedValue(1_000_000_000n);
  mocks.publicClient.simulateContract.mockResolvedValue({ request: {} });
  mocks.publicClient.waitForTransactionReceipt.mockResolvedValue(receipt());
  mocks.publicClient.getTransaction.mockResolvedValue(intended());
  mocks.wallet.getChainId.mockResolvedValue(31337);
  mocks.wallet.getAddresses.mockResolvedValue([mocks.account]);
  mocks.wallet.writeContract.mockResolvedValue(mocks.originalHash);
});
afterEach(cleanup);

describe("confirmed transaction identity", () => {
  it("completes an original successful call only after checking its mined input and value", async () => {
    const { complete, invalidate } = mount();
    await submit();
    await waitFor(() => expect(complete).toHaveBeenCalledWith(receipt()));
    expect(screen.getByTestId("phase").textContent).toBe("included");
    expect(screen.getByTestId("hash").textContent).toBe(mocks.originalHash);
    expect(mocks.publicClient.getTransaction).toHaveBeenCalledWith({
      hash: mocks.originalHash,
    });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
  it("accepts a fee-only speedup and reports the actual mined hash", async () => {
    const replacement = receipt(mocks.replacementHash);
    mocks.publicClient.waitForTransactionReceipt.mockImplementation(
      async ({ onReplaced }) => {
        onReplaced({ reason: "repriced", transactionReceipt: replacement });
        return replacement;
      },
    );
    const { complete } = mount();
    await submit();
    await waitFor(() => expect(complete).toHaveBeenCalledWith(replacement));
    expect(screen.getByTestId("phase").textContent).toBe("included");
    expect(screen.getByTestId("hash").textContent).toBe(mocks.replacementHash);
    expect(mocks.publicClient.getTransaction).toHaveBeenCalledWith({
      hash: mocks.replacementHash,
    });
  });
  it("does not treat a successful wallet cancellation as action completion", async () => {
    const replacement = receipt(mocks.replacementHash);
    mocks.publicClient.waitForTransactionReceipt.mockImplementation(
      async ({ onReplaced }) => {
        onReplaced({ reason: "cancelled", transactionReceipt: replacement });
        return replacement;
      },
    );
    mocks.publicClient.getTransaction.mockResolvedValue({
      ...intended(),
      to: mocks.account,
      input: "0x",
      value: 0n,
    });
    const { complete, invalidate } = mount();
    await submit();
    await waitFor(() => expect(complete).toHaveBeenCalledWith(undefined));
    expect(screen.getByTestId("phase").textContent).toBe("error");
    expect(screen.getByTestId("hash").textContent).toBe(mocks.replacementHash);
    expect(screen.getByTestId("message").textContent).toContain(
      "replaced or cancelled",
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["sender", { from: "0x3333333333333333333333333333333333333333" }],
    ["recipient", { to: mocks.account }],
    ["input", { input: "0x12345678" }],
    ["value", { value: 124n }],
  ])(
    "rejects a replacement with changed %s and refreshes reads",
    async (_field, changes) => {
      const replacement = receipt(mocks.replacementHash);
      mocks.publicClient.waitForTransactionReceipt.mockImplementation(
        async ({ onReplaced }) => {
          onReplaced({ reason: "replaced", transactionReceipt: replacement });
          return replacement;
        },
      );
      mocks.publicClient.getTransaction.mockResolvedValue({
        ...intended(),
        ...changes,
      });
      const { complete, invalidate } = mount();
      await submit();
      await waitFor(() => expect(complete).toHaveBeenCalledWith(undefined));
      expect(screen.getByTestId("phase").textContent).toBe("error");
      expect(screen.getByTestId("hash").textContent).toBe(
        mocks.replacementHash,
      );
      expect(invalidate).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects a reverted matching transaction", async () => {
    mocks.publicClient.waitForTransactionReceipt.mockResolvedValue(
      receipt(mocks.originalHash, "reverted"),
    );
    const { complete, invalidate } = mount();
    await submit();
    await waitFor(() => expect(complete).toHaveBeenCalledWith(undefined));
    expect(screen.getByTestId("message").textContent).toContain(
      "transaction reverted",
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
  it("does not show raw simulation errors that may contain a reveal secret", async () => {
    mocks.publicClient.simulateContract.mockRejectedValue(
      new Error(
        'The contract function "reveal" reverted. Contract Call args: privateword, secret-salt',
      ),
    );
    const { complete } = mount();
    await submit();
    await waitFor(() => expect(complete).toHaveBeenCalledWith(undefined));
    expect(screen.getByTestId("message").textContent).not.toContain(
      "privateword",
    );
    expect(screen.getByTestId("message").textContent).not.toContain(
      "secret-salt",
    );
    expect(mocks.wallet.writeContract).not.toHaveBeenCalled();
  });
});

it("reads the game and transcript at one pinned block", async () => {
  function Snapshot() {
    const game = useGame(7n);
    return <output>{game.isSuccess ? "loaded" : "loading"}</output>;
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mocks.publicClient.readContract.mockImplementation(
    async ({ functionName }) =>
      functionName === "getGuesses"
        ? [[], []]
        : functionName === "getGame"
          ? {}
          : 1n,
  );
  render(
    <QueryClientProvider client={client}>
      <Snapshot />
    </QueryClientProvider>,
  );
  await screen.findByText("loaded");
  const reads = mocks.publicClient.readContract.mock.calls
    .map(([call]) => call)
    .filter((call) => ["getGame", "getGuesses"].includes(call.functionName));
  expect(reads).toHaveLength(2);
  expect(reads.every((call) => call.blockNumber === 88n)).toBe(true);
});

describe("dictionary deployment binding", () => {
  const root = `0x${"ab".repeat(32)}`;
  const verifier = "0x3333333333333333333333333333333333333333";
  beforeEach(() => {
    mocks.publicClient.readContract.mockImplementation(
      async ({ functionName }) =>
        functionName === "dictionaryRoot"
          ? root
          : functionName === "dictionaryVerifier"
            ? verifier
            : 1n,
    );
  });
  it("requires the expected on-chain root and a deployed verifier", async () => {
    await expect(assertDictionaryDeployment(root)).resolves.toBeUndefined();
    expect(mocks.publicClient.getCode).toHaveBeenCalledWith({
      address: verifier,
    });
    await expect(
      assertDictionaryDeployment(`0x${"cd".repeat(32)}`),
    ).rejects.toThrow("dictionary deployment changed");
  });
  it("rejects a missing verifier or changed RPC network", async () => {
    mocks.publicClient.getCode.mockResolvedValue("0x");
    await expect(assertDictionaryDeployment(root)).rejects.toThrow("not ready");
    mocks.publicClient.getCode.mockResolvedValue("0x6000");
    mocks.publicClient.getChainId.mockResolvedValue(1);
    await expect(assertDictionaryDeployment(root)).rejects.toThrow("not ready");
  });
});

describe("fail-closed network health", () => {
  function Health() {
    const health = useNetworkStatus();
    return (
      <>
        <output data-testid="health">{health.data.status}</output>
        <button onClick={() => health.refetch()}>Refresh health</button>
      </>
    );
  }
  function mountHealth() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Health />
      </QueryClientProvider>,
    );
  }
  it("starts unverified and clears cached Ready on a failed RPC refresh", async () => {
    mocks.publicClient.readContract.mockImplementation(
      async ({ functionName }) =>
        functionName === "getNetworkStatus" ? [3, 1n, 100n] : 1n,
    );
    mountHealth();
    expect(screen.getByTestId("health").textContent).toBe("-1");
    await waitFor(() =>
      expect(screen.getByTestId("health").textContent).toBe("3"),
    );
    mocks.publicClient.readContract.mockRejectedValue(
      new Error("RPC read failed"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh health" }));
    await waitFor(() =>
      expect(screen.getByTestId("health").textContent).toBe("-1"),
    );
  });
  it.each(["malformed", "wrong network"])(
    "turns a cached Ready observation into unknown after %s",
    async (failure) => {
      mocks.publicClient.readContract.mockImplementation(
        async ({ functionName }) =>
          functionName === "getNetworkStatus" ? [3, 1n, 100n] : 1n,
      );
      mountHealth();
      await waitFor(() =>
        expect(screen.getByTestId("health").textContent).toBe("3"),
      );
      if (failure === "malformed")
        mocks.publicClient.readContract.mockResolvedValue([
          3,
          "bad-round",
          100n,
        ]);
      else mocks.publicClient.getChainId.mockResolvedValue(1);
      fireEvent.click(screen.getByRole("button", { name: "Refresh health" }));
      await waitFor(() =>
        expect(screen.getByTestId("health").textContent).toBe("-1"),
      );
    },
  );
  it.each([0, 1, 2, 3])(
    "reads explicit status %s without assuming readiness",
    async (status) => {
      mocks.publicClient.readContract.mockImplementation(
        async ({ functionName }) =>
          functionName === "getNetworkStatus" ? [status, 1n, 100n] : 1n,
      );
      mountHealth();
      await waitFor(() =>
        expect(mocks.publicClient.readContract).toHaveBeenCalledWith(
          expect.objectContaining({ functionName: "getNetworkStatus" }),
        ),
      );
      await waitFor(() =>
        expect(screen.getByTestId("health").textContent).toBe(String(status)),
      );
    },
  );
  it.each([[4, 1n, 0n], [3, "1", 0n], null])(
    "treats malformed health data %j as unverified",
    async (result) => {
      mocks.publicClient.readContract.mockResolvedValue(result);
      await expect(assertNetworkReady()).rejects.toThrow(
        "Network health is unverified",
      );
    },
  );
  it.each([
    [0, "Network health is unavailable"],
    [1, "network sequencer is down"],
    [2, "24-hour recovery grace period"],
  ])("blocks fresh creation checks for status %s", async (status, message) => {
    mocks.publicClient.readContract.mockResolvedValue([status, 1n, 100n]);
    await expect(assertNetworkReady()).rejects.toThrow(message as string);
  });
  it.each(["RPC failure", "malformed", "wrong network"])(
    "does not promise paused deadlines after a fresh %s",
    async (failure) => {
      mocks.publicClient.readContract.mockResolvedValue([3, 1n, 100n]);
      if (failure === "RPC failure")
        mocks.publicClient.readContract.mockRejectedValue(
          new Error("secret-word private-salt"),
        );
      if (failure === "malformed")
        mocks.publicClient.readContract.mockResolvedValue([
          3,
          "bad-round",
          100n,
        ]);
      if (failure === "wrong network")
        mocks.publicClient.getChainId.mockResolvedValue(1);
      const error = await assertNetworkReady().catch((error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain("health is unverified");
      expect(error.message).toContain("deadlines may continue");
      expect(error.message).not.toMatch(
        /paused|remain escrowed|secret-word|private-salt/,
      );
    },
  );
  it("accepts Ready during recovery grace and sanitizes unavailable RPC errors", async () => {
    mocks.publicClient.readContract.mockResolvedValue([3, 1n, 9999999999n]);
    await expect(assertNetworkReady()).resolves.toBeUndefined();
    mocks.publicClient.readContract.mockRejectedValue(
      new Error("privateword secret-salt"),
    );
    await expect(assertNetworkReady()).rejects.toThrow(
      "Network health is unverified",
    );
  });
});

describe("safe network transaction errors", () => {
  it.each([
    ["SequencerUnavailable", "Network health is unavailable"],
    ["SequencerDown", "network sequencer is down"],
    ["RecoverySyncRequired", "24-hour recovery grace period"],
  ])(
    "shows authored guidance for %s without decoded arguments",
    async (errorName, message) => {
      mocks.publicClient.simulateContract.mockRejectedValue(
        Object.assign(new Error("privateword secret-salt"), {
          cause: { data: { errorName, args: ["privateword", "secret-salt"] } },
        }),
      );
      const { complete } = mount();
      await submit();
      await waitFor(() => expect(complete).toHaveBeenCalledWith(undefined));
      const rendered = screen.getByTestId("message").textContent;
      expect(rendered).toContain(message);
      expect(rendered).not.toContain("privateword");
      expect(rendered).not.toContain("secret-salt");
      expect(mocks.wallet.writeContract).not.toHaveBeenCalled();
    },
  );
});

describe("transaction review", () => {
  it("never asks for a signature until reviewed and re-estimates before signing", async () => {
    const { complete } = mount();
    await submit(false);
    await waitFor(() =>
      expect(screen.getByTestId("fee-status").textContent).toBe("ready"),
    );
    expect(mocks.wallet.writeContract).not.toHaveBeenCalled();
    expect(mocks.publicClient.estimateGas).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(receipt()));
    expect(mocks.publicClient.estimateGas).toHaveBeenCalledTimes(2);
    expect(mocks.wallet.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: mocks.contract,
        account: mocks.account,
        functionName: "joinGame",
        args: [7n],
        value: 123n,
        type: "legacy",
        gas: 130000n,
        gasPrice: 1000000000n,
      }),
    );
  });
  it("cancels review without submitting", async () => {
    const { complete } = mount();
    await submit(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel transaction" }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(undefined));
    expect(screen.getByTestId("phase").textContent).toBe("cancelled");
    expect(mocks.wallet.writeContract).not.toHaveBeenCalled();
  });
  it("cancels a pending estimate and ignores its later completion", async () => {
    let resolveEstimate!: (value: bigint) => void;
    mocks.publicClient.estimateGas.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveEstimate = resolve;
        }),
    );
    const { complete } = mount();
    await submit(false);
    expect(screen.getByTestId("fee-status").textContent).toBe("refreshing");
    fireEvent.click(screen.getByRole("button", { name: "Cancel transaction" }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(undefined));
    resolveEstimate(100000n);
    await waitFor(() =>
      expect(screen.getByTestId("phase").textContent).toBe("cancelled"),
    );
    expect(mocks.wallet.writeContract).not.toHaveBeenCalled();
  });
  it("disables signing when estimates fail and recovers through explicit refresh", async () => {
    mocks.publicClient.estimateGas.mockRejectedValueOnce(
      new Error("privateword secret-salt"),
    );
    const { complete } = mount();
    await submit(false);
    await waitFor(() =>
      expect(screen.getByTestId("fee-status").textContent).toBe("unavailable"),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Continue to wallet",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByTestId("message").textContent).toContain(
      "Fee estimate unavailable",
    );
    expect(screen.getByTestId("message").textContent).not.toContain(
      "privateword",
    );
    expect(mocks.wallet.writeContract).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh estimate" }));
    await waitFor(() =>
      expect(screen.getByTestId("fee-status").textContent).toBe("ready"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(receipt()));
  });
  it("rejects stale reviews until explicitly refreshed", async () => {
    const { complete } = mount();
    await submit(false);
    await waitFor(() =>
      expect(screen.getByTestId("fee-status").textContent).toBe("ready"),
    );
    const time = Date.now() + 30001;
    vi.spyOn(Date, "now").mockReturnValue(time);
    fireEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
    await waitFor(() =>
      expect(screen.getByTestId("message").textContent).toContain("stale"),
    );
    expect(mocks.wallet.writeContract).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh estimate" }));
    await waitFor(() =>
      expect(screen.getByTestId("fee-status").textContent).toBe("ready"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(receipt()));
  });
  it("returns to review if fresh fees increase or become unavailable", async () => {
    const { complete } = mount();
    await submit(false);
    await waitFor(() =>
      expect(screen.getByTestId("fee-status").textContent).toBe("ready"),
    );
    mocks.publicClient.getGasPrice.mockResolvedValue(2000000000n);
    fireEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
    await waitFor(() =>
      expect(screen.getByTestId("message").textContent).toContain(
        "changed or expired",
      ),
    );
    expect(mocks.wallet.writeContract).not.toHaveBeenCalled();
    mocks.publicClient.getGasPrice.mockRejectedValueOnce(
      new Error("RPC failure"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
    await waitFor(() =>
      expect(screen.getByTestId("fee-status").textContent).toBe("unavailable"),
    );
    expect(mocks.wallet.writeContract).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel transaction" }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(undefined));
  });
  it.each(["account", "network"])(
    "rejects a wallet %s change during review",
    async (change) => {
      const { complete } = mount();
      await submit(false);
      await waitFor(() =>
        expect(screen.getByTestId("fee-status").textContent).toBe("ready"),
      );
      if (change === "account")
        mocks.wallet.getAddresses.mockResolvedValue([mocks.contract]);
      else mocks.wallet.getChainId.mockResolvedValue(1);
      fireEvent.click(
        screen.getByRole("button", { name: "Continue to wallet" }),
      );
      await waitFor(() => expect(complete).toHaveBeenCalledWith(undefined));
      expect(screen.getByTestId("message").textContent).toContain(
        "wallet account or network changed",
      );
      expect(mocks.wallet.writeContract).not.toHaveBeenCalled();
    },
  );
  it("snapshots the reviewed call even if the caller later mutates its args", async () => {
    const { complete } = mount();
    await submit(false);
    await waitFor(() =>
      expect(screen.getByTestId("fee-status").textContent).toBe("ready"),
    );
    mocks.args[0] = 999n;
    fireEvent.click(screen.getByRole("button", { name: "Continue to wallet" }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(receipt()));
    expect(mocks.wallet.writeContract.mock.calls[0][0].args).toEqual([7n]);
  });
});

describe("inclusion and finality observations", () => {
  it("returns an included receipt without claiming Ethereum finality locally", async () => {
    const { complete } = mount();
    await submit();
    await waitFor(() => expect(complete).toHaveBeenCalledWith(receipt()));
    await waitFor(() =>
      expect(screen.getByTestId("finality").textContent).toBe("local"),
    );
    expect(screen.getByTestId("message").textContent).toBe("Included on-chain");
  });
  it("keeps finality explicitly unknown when the RPC fails", async () => {
    mocks.publicClient.getBlock.mockRejectedValue(
      new Error("RPC failure privateword"),
    );
    const { complete } = mount();
    await submit();
    await waitFor(() => expect(complete).toHaveBeenCalledWith(receipt()));
    await waitFor(() =>
      expect(screen.getByTestId("finality").textContent).toBe("unknown"),
    );
    expect(screen.getByTestId("phase").textContent).toBe("included");
  });
  it("replaces the included state with a reorg warning and refreshes game reads", async () => {
    mocks.publicClient.getBlock.mockResolvedValue({
      hash: mocks.replacementHash,
      number: 88n,
    });
    const { invalidate } = mount();
    await submit();
    await waitFor(() =>
      expect(screen.getByTestId("finality").textContent).toBe("reorg"),
    );
    expect(screen.getByTestId("phase").textContent).toBe("error");
    expect(screen.getByTestId("message").textContent).toContain(
      "no longer canonical",
    );
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
  it("does not let a late finality result replace a newer transaction review", async () => {
    let resolveBlock!: (value: unknown) => void;
    mocks.publicClient.getBlock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBlock = resolve;
        }),
    );
    const { complete } = mount();
    await submit();
    await waitFor(() => expect(complete).toHaveBeenCalledWith(receipt()));
    await waitFor(() => expect(mocks.publicClient.getBlock).toHaveBeenCalled());
    await submit(false);
    resolveBlock({ hash: mocks.replacementHash, number: 88n });
    await waitFor(() =>
      expect(screen.getByTestId("fee-status").textContent).toBe("ready"),
    );
    expect(screen.getByTestId("phase").textContent).toBe("review");
    expect(screen.getByTestId("finality").textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel transaction" }));
  });
});
