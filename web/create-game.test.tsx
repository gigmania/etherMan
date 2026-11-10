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
  checkWord: vi.fn(),
  proveWord: vi.fn(),
  assertDictionary: vi.fn(),
  chainId: 31337,
  root: "0x" + "12".repeat(32),
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
    chainId: mocks.chainId,
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
  useDictionaryRoot: () => ({ data: mocks.root }),
  assertDictionaryDeployment: mocks.assertDictionary,
  useClock: () => 90,
  useCredits: mocks.useCredits,
  useGame: mocks.useGame,
  useGames: vi.fn(),
  TransactionProvider: vi.fn(),
}));
vi.mock("./dictionary", () => ({
  checkDictionaryWord: mocks.checkWord,
  proveDictionaryWord: mocks.proveWord,
  DictionaryError: class DictionaryError extends Error {},
  dictionaryErrors: {
    assets: "Dictionary unavailable.",
    proof: "Proof failed safely.",
    cancelled: "Proof generation cancelled. No transaction was submitted.",
  },
}));
import { CreateGame, Credits, GameView } from "./App";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.account = "0x1111111111111111111111111111111111111111";
  mocks.chainId = 31337;
  mocks.checkWord.mockReset().mockResolvedValue(undefined);
  mocks.proveWord
    .mockReset()
    .mockResolvedValue({ proof: "0xabcd", publicInputs: [], timings: {} });
  mocks.assertDictionary.mockReset().mockResolvedValue(undefined);
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

it("keeps the word visible by default and masks it without credential input semantics", () => {
  render(<CreateGame remember={vi.fn()} />);
  const input = screen.getByLabelText(/Your secret word/) as HTMLInputElement;
  expect(input.type).toBe("text");
  expect(input.name).toBe("game-word");
  expect(input.autocomplete).toBe("off");
  expect(input.hasAttribute("maxLength")).toBe(false);
  expect(input.dataset.masked).toBe("false");
  fireEvent.change(input, {
    target: { value: "ethylenediaminetetraacetates" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Hide word" }));
  expect(input.type).toBe("text");
  expect(input.dataset.masked).toBe("true");
  expect(input.value).toBe("ethylenediaminetetraacetates");
  fireEvent.click(screen.getByRole("button", { name: "Show word" }));
  expect(input.dataset.masked).toBe("false");
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.checkWord).not.toHaveBeenCalled();
});

it.each(["ab", "ethylenediaminetetraacetates"])(
  "creates a game for dictionary word %s without truncating the input",
  async (word) => {
    const remember = vi.fn();
    render(<CreateGame remember={remember} />);
    fireEvent.change(screen.getByLabelText(/Your secret word/), {
      target: { value: word },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Download recovery file/ }),
    );
    fireEvent.click(await screen.findByRole("checkbox"));
    expect(mocks.checkWord).toHaveBeenCalledWith(word, mocks.root);
    fireEvent.click(
      screen.getByRole("button", { name: /Lock stake & create game/ }),
    );
    await waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
    expect(remember.mock.calls[0][0]).toMatchObject({ version: 1, word });
    expect(mocks.run.mock.calls[0][2][1]).toBe(word.length);
  },
);

it("submits creator responses with the 28th letter position intact", async () => {
  const word = "ethylenediaminetetraacetates";
  const salt = `0x${"01".repeat(32)}` as Hex;
  const commitment = wordCommitment(
    31337,
    mocks.contract as Address,
    mocks.account as Address,
    word,
    salt,
  );
  const secret: Recovery = {
    version: 1,
    chainId: 31337,
    contract: mocks.contract as Address,
    creator: mocks.account as Address,
    word,
    salt,
    commitment,
  };
  const game: Game = {
    creator: mocks.account as Address,
    challenger: "0x3333333333333333333333333333333333333333",
    commitment,
    stake: 1n,
    deadline: 100n,
    wordLength: 28,
    maxMisses: 6,
    misses: 0,
    guessedLetters: 1 << 18,
    revealedMask: 0,
    pendingLetter: 18,
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
    ).toBe(word),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Submit letter positions/ }),
  );
  expect(mocks.run).toHaveBeenCalledWith("Respond to guess", "respond", [
    7n,
    18,
    2 ** 27,
  ]);
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
  fireEvent.click(await screen.findByRole("checkbox"));
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
  expect(mocks.run.mock.calls[0][2][3]).toBe("0xabcd");
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
  fireEvent.click(await screen.findByRole("checkbox"));
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

async function prepareCreation() {
  fireEvent.change(screen.getByLabelText(/Your secret word/), {
    target: { value: "ether" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: /Download recovery file/ }),
  );
  fireEvent.click(await screen.findByRole("checkbox"));
  return screen.getByRole("button", { name: /Lock stake & create game/ });
}

it("rejects a nondictionary word before generating a recovery file", async () => {
  const { DictionaryError } = await import("./dictionary");
  mocks.checkWord.mockRejectedValue(
    new DictionaryError("Choose a word from this game's English dictionary."),
  );
  render(<CreateGame remember={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/Your secret word/), {
    target: { value: "zzzzzz" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: /Download recovery file/ }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "game's English dictionary",
  );
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(mocks.proveWord).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});

it("cancels proving without consuming the backup or submitting a transaction", async () => {
  let resolveProof: (value: unknown) => void = () => {};
  mocks.proveWord.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveProof = resolve;
      }),
  );
  const remember = vi.fn();
  render(<CreateGame remember={remember} />);
  const submit = await prepareCreation();
  fireEvent.click(submit);
  await screen.findByRole("button", { name: "Cancel proof" });
  const signal = mocks.proveWord.mock.calls[0][2] as AbortSignal;
  fireEvent.click(screen.getByRole("button", { name: "Cancel proof" }));
  expect(signal.aborted).toBe(true);
  resolveProof({ proof: "0xabcd" });
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Cancel proof" })).toBeNull(),
  );
  expect(mocks.run).not.toHaveBeenCalled();
  expect(remember).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox")).toBeTruthy();
});

it.each(["wallet", "word", "network"])(
  "discards proof completion after a %s change",
  async (change) => {
    let resolveProof: (value: unknown) => void = () => {};
    mocks.proveWord.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProof = resolve;
        }),
    );
    const remember = vi.fn();
    const view = render(<CreateGame remember={remember} />);
    fireEvent.click(await prepareCreation());
    await screen.findByRole("button", { name: "Cancel proof" });
    if (change === "wallet")
      mocks.account = "0x3333333333333333333333333333333333333333";
    if (change === "network") mocks.chainId = 11155111;
    if (change === "word")
      fireEvent.change(screen.getByLabelText(/Your secret word/), {
        target: { value: "other" },
      });
    else view.rerender(<CreateGame remember={remember} />);
    expect((mocks.proveWord.mock.calls[0][2] as AbortSignal).aborted).toBe(
      true,
    );
    resolveProof({ proof: "0xabcd" });
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
    expect(mocks.run).not.toHaveBeenCalled();
    expect(remember).not.toHaveBeenCalled();
  },
);

it("does not start concurrent proofs on repeated submits", async () => {
  mocks.proveWord.mockImplementation(() => new Promise(() => {}));
  render(<CreateGame remember={vi.fn()} />);
  const submit = await prepareCreation();
  fireEvent.submit(submit.closest("form")!);
  fireEvent.submit(submit.closest("form")!);
  expect(mocks.proveWord).toHaveBeenCalledTimes(1);
  expect(mocks.run).not.toHaveBeenCalled();
});
