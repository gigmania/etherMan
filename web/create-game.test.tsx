import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { wordCommitment, type Game, type Recovery } from "./domain";
import type { Address, Hex } from "viem";
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  useGame: vi.fn(),
  useCredits: vi.fn(),
  account: "0x1111111111111111111111111111111111111111",
  contract: "0x2222222222222222222222222222222222222222",
}));
vi.mock("./config", () => ({
  contractAddress: mocks.contract,
  setupIssue: undefined,
  targetChain: { id: 31337, name: "Local test chain" },
}));
vi.mock("wagmi", () => ({
  useConnection: () => ({
    address: mocks.account,
    chainId: 31337,
    isConnected: true,
  }),
  useConnect: vi.fn(),
  useConnectors: vi.fn(),
  useDisconnect: vi.fn(),
  useSwitchChain: vi.fn(),
}));
vi.mock("./chain", () => ({
  useTransaction: () => ({ run: mocks.run, busy: false }),
  useDeployment: () => ({ data: true }),
  useClock: () => 90,
  useCredits: mocks.useCredits,
  useGame: mocks.useGame,
  useGames: vi.fn(),
  TransactionProvider: vi.fn(),
}));
import { CreateGame, Credits, GameView } from "./App";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.account = "0x1111111111111111111111111111111111111111";
  mocks.useCredits.mockReturnValue({ data: 1n });
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:private-backup"),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("consumes a prepared secret before submission and retains it after uncertain confirmation", async () => {
  const recoveries: Recovery[] = [];
  let finish: (value: undefined) => void = () => {};
  mocks.run
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  function Harness() {
    const [saved, setSaved] = useState<Record<string, Recovery>>({});
    return (
      <>
        <CreateGame
          remember={(r) => {
            recoveries.push(r);
            setSaved((prev) => ({ ...prev, [r.commitment]: r }));
          }}
        />
        <output data-testid="retained-count">
          {Object.keys(saved).length}
        </output>
      </>
    );
  }
  render(<Harness />);
  fireEvent.change(screen.getByLabelText(/Your secret word/), {
    target: { value: "ether" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: /Download recovery file/ }),
  );
  fireEvent.click(screen.getByRole("checkbox"));
  const submit = screen.getByRole("button", {
    name: /Lock stake & create game/,
  }) as HTMLButtonElement;
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);
  await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId("retained-count").textContent).toBe("1");
  expect(recoveries).toHaveLength(1);
  const first = recoveries[0];
  expect(mocks.run.mock.calls[0][2][0]).toBe(first.commitment);
  expect(submit.disabled).toBe(true);
  expect(screen.queryByRole("checkbox")).toBeNull();

  // Receipt lookup times out: the first transaction may still mine later.
  finish(undefined);
  await waitFor(() =>
    expect(screen.getByTestId("retained-count").textContent).toBe("1"),
  );
  fireEvent.submit(submit.closest("form")!);
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert").textContent).toContain(
    "Download and confirm",
  );

  fireEvent.click(
    screen.getByRole("button", { name: /Download recovery file/ }),
  );
  expect(submit.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(submit);
  await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(2));
  expect(recoveries).toHaveLength(2);
  expect(recoveries[1].word).toBe(first.word);
  expect(recoveries[1].salt).not.toBe(first.salt);
  expect(recoveries[1].commitment).not.toBe(first.commitment);
  expect(screen.getByTestId("retained-count").textContent).toBe("2");
  expect(recoveries[0]).toEqual(first);
});

it("binds creator responses to the viewed letter and rejects a changed recovery word", async () => {
  const salt = `0x${"01".repeat(32)}` as Hex;
  const commitment = wordCommitment(
    31337,
    mocks.contract as Address,
    mocks.account as Address,
    "ether",
    salt,
  );
  const secret: Recovery = {
    version: 1,
    chainId: 31337,
    contract: mocks.contract as Address,
    creator: mocks.account as Address,
    word: "ether",
    salt,
    commitment,
  };
  const game: Game = {
    creator: mocks.account as Address,
    challenger: "0x3333333333333333333333333333333333333333",
    commitment,
    stake: 1n,
    deadline: 100n,
    wordLength: 5,
    maxMisses: 6,
    misses: 0,
    guessedLetters: 16,
    revealedMask: 0,
    pendingLetter: 4,
    state: 2,
    winner: "0x0000000000000000000000000000000000000000",
    finalWord: "",
  };
  mocks.useGame.mockReturnValue({
    data: { game, guesses: [[], []] },
    refetch: vi.fn(),
  });
  render(<GameView id={7n} secret={secret} />);
  await waitFor(() =>
    expect(
      (screen.getByLabelText(/Your secret word/) as HTMLInputElement).value,
    ).toBe("ether"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Submit letter positions/ }),
  );
  expect(mocks.run).toHaveBeenCalledWith("Respond to guess", "respond", [
    7n,
    4,
    9,
  ]);
  mocks.run.mockClear();
  fireEvent.change(screen.getByLabelText(/Your secret word/), {
    target: { value: "other" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: /Submit letter positions/ }),
  );
  expect(mocks.run).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain(
    "word and salt do not match",
  );
});

it("clears the withdrawal recipient and validation error when the wallet account changes", () => {
  const view = render(<Credits />);
  fireEvent.change(screen.getByLabelText(/Recipient/), {
    target: { value: "invalid" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Withdraw ETH/ }));
  expect(screen.getByRole("alert").textContent).toContain("valid, nonzero");
  mocks.account = "0x3333333333333333333333333333333333333333";
  view.rerender(<Credits />);
  expect((screen.getByLabelText(/Recipient/) as HTMLInputElement).value).toBe(
    "",
  );
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Withdraw ETH/ }));
  expect(mocks.run).toHaveBeenCalledWith("Withdraw balance", "withdrawTo", [
    mocks.account,
  ]);
});
