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
  publicClient: {
    getChainId: vi.fn(),
    getCode: vi.fn(),
    readContract: vi.fn(),
    getBlockNumber: vi.fn(),
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
          complete(await tx.run("Join game", "joinGame", [7n], 123n))
        }
      >
        Submit
      </button>
      <output data-testid="phase">{tx.state.phase}</output>
      <output data-testid="hash">{tx.state.hash}</output>
      <output data-testid="message">{tx.state.message}</output>
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
async function submit() {
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
}
function receipt(hash = mocks.originalHash, status = "success") {
  return { transactionHash: hash, status, logs: [] };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.publicClient.getChainId.mockResolvedValue(31337);
  mocks.publicClient.getCode.mockResolvedValue("0x6000");
  mocks.publicClient.readContract.mockResolvedValue(1n);
  mocks.publicClient.getBlockNumber.mockResolvedValue(88n);
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
    expect(screen.getByTestId("phase").textContent).toBe("success");
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
    expect(screen.getByTestId("phase").textContent).toBe("success");
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
