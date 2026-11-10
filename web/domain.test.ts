import { describe, expect, it } from "vitest";
import { parseEther, type Address, type Hex } from "viem";
import {
  gameActions,
  effectiveDeadline,
  gameTimeLeft,
  type NetworkStatus,
  maskFor,
  parseRecovery,
  parseStake,
  roleOf,
  validateWord,
  visibleWord,
  wordCommitment,
  type Game,
} from "./domain";
const creator = "0x1111111111111111111111111111111111111111" as Address;
const challenger = "0x2222222222222222222222222222222222222222" as Address;
const contract = "0x3333333333333333333333333333333333333333" as Address;
const salt = `0x${"01".repeat(32)}` as Hex;
const commitment = wordCommitment(31337, contract, creator, "ether", salt);
const backup = {
  version: 1,
  chainId: 31337,
  creator,
  contract,
  word: "ether",
  salt,
  commitment,
};
const expected = { chainId: 31337, creator, contract, commitment };
const network: NetworkStatus = { status: 3, roundId: 1n, recoveryUntil: 0n };
const game: Game = {
  creator,
  challenger,
  commitment,
  stake: 1n,
  deadline: 100n,
  wordLength: 5,
  maxMisses: 6,
  misses: 0,
  guessedLetters: 0,
  revealedMask: 0,
  pendingLetter: 26,
  state: 1,
  winner: creator,
  finalWord: "",
};
describe("precise amounts and canonical words", () => {
  it("preserves wei beyond JavaScript safe integers", () => {
    expect(parseStake("0.001")).toBe(1000000000000000n);
    expect(parseStake("0.123456789123456789")).toBe(123456789123456789n);
    expect(parseStake("0.000000000000000001")).toBe(1n);
    expect(parseStake("1")).toBe(parseEther("1"));
  });
  it.each([
    "0",
    "-1",
    "1.000000000000000001",
    "1e-3",
    "0.0000000000000000001",
    "Infinity",
    "0x1",
    "",
    " 0.1",
    ".1",
  ])("rejects invalid stake %s", (value) =>
    expect(() => parseStake(value)).toThrow(),
  );
  it.each(["", "Ether", "two words", "café", "abc1"])(
    "rejects invalid word %s",
    (word) => expect(() => validateWord(word)).toThrow(),
  );
  it.each([
    "ab",
    "abcdefghijklmn",
    "ethylenediaminetetraacetates",
    "a".repeat(100),
  ])(
    "accepts lowercase syntax without imposing a dictionary length limit: %s",
    (word) => expect(validateWord(word)).toBe(word),
  );
});
describe("private recovery", () => {
  it.each(["ab", "abcdefghijklmn", "ethylenediaminetetraacetates"])(
    "preserves version 1 recovery for %s",
    (word) => {
      const commitment = wordCommitment(31337, contract, creator, word, salt);
      expect(
        parseRecovery(JSON.stringify({ ...backup, word, commitment }), {
          ...expected,
          commitment,
        }),
      ).toMatchObject({ version: 1, word, commitment, salt });
    },
  );
  it("validates network, contract, owner and commitment", () =>
    expect(parseRecovery(JSON.stringify(backup), expected).word).toBe("ether"));
  it("domain-separates the commitment", () => {
    expect(wordCommitment(1, contract, creator, "ether", salt)).not.toBe(
      commitment,
    );
    expect(wordCommitment(31337, challenger, creator, "ether", salt)).not.toBe(
      commitment,
    );
    expect(wordCommitment(31337, contract, challenger, "ether", salt)).not.toBe(
      commitment,
    );
  });
  it.each([
    { chainId: 1 },
    { creator: challenger },
    { contract: challenger },
    { word: "other" },
    { salt: "0x00" },
    { version: 2 },
    { word: null },
  ])("rejects altered recovery %j", (alteration) =>
    expect(() =>
      parseRecovery(JSON.stringify({ ...backup, ...alteration }), expected),
    ).toThrow(),
  );
  it("rejects another game commitment and oversized files", () => {
    expect(() =>
      parseRecovery(JSON.stringify(backup), { ...expected, commitment: salt }),
    ).toThrow();
    expect(() => parseRecovery(" ".repeat(4097), expected)).toThrow();
  });
});
describe("game state and masks", () => {
  it("preserves every bit through the 28th letter in uint32 masks", () => {
    const word = "a".repeat(27) + "z";
    expect(maskFor(word, 25)).toBe(2 ** 27);
    expect(maskFor("a".repeat(28), 0)).toBe(2 ** 28 - 1);
    expect(
      visibleWord(28, [0, 25], [maskFor(word, 0), maskFor(word, 25)]).join(""),
    ).toBe(word);
  });
  it("maps all occurrences and reconstructs only reported letters", () => {
    expect(maskFor("ether", 4)).toBe(9);
    expect(maskFor("ether", 25)).toBe(0);
    expect(visibleWord(5, [4, 19], [9, 2])).toEqual(["e", "t", "", "e", ""]);
  });
  it("permits a challenger guess through the exact deadline, then only timeout", () => {
    expect(gameActions(game, challenger, 100, network).guess).toBe(true);
    expect(gameActions(game, challenger, 101, network).guess).toBe(false);
    expect(gameActions(game, challenger, 101, network).timeout).toBe(true);
  });
  it("restricts roles and terminal states", () => {
    expect(roleOf(game, creator)).toBe("creator");
    expect(gameActions(game, creator, 90, network).guess).toBe(false);
    expect(gameActions(game, undefined, 101, network).timeout).toBe(false);
    expect(
      gameActions({ ...game, state: 4 }, challenger, 101, network).timeout,
    ).toBe(false);
    expect(
      gameActions({ ...game, state: 3 }, creator, 99, network).reveal,
    ).toBe(true);
    expect(
      gameActions({ ...game, state: 3 }, challenger, 99, network).reveal,
    ).toBe(false);
  });
  it("does not let creators join their own lobby", () => {
    expect(
      gameActions(
        {
          ...game,
          state: 0,
          challenger: "0x0000000000000000000000000000000000000000",
        },
        creator,
        90,
        network,
      ).join,
    ).toBe(false);
    expect(
      gameActions(
        {
          ...game,
          state: 0,
          challenger: "0x0000000000000000000000000000000000000000",
        },
        challenger,
        90,
        network,
      ).join,
    ).toBe(true);
  });
});

describe("network recovery deadlines", () => {
  it("defaults to unverified and blocks active actions", () => {
    expect(gameActions(game, challenger, 90).guess).toBe(false);
    expect(gameActions(game, creator, 101).timeout).toBe(false);
  });
  it.each([0, 1, 2] as const)(
    "blocks play and active timeouts with network status %s",
    (status) => {
      const health = { ...network, status };
      expect(
        gameActions({ ...game, state: 0 }, challenger, 90, health).join,
      ).toBe(false);
      expect(gameActions(game, challenger, 90, health)).toMatchObject({
        guess: false,
        concede: false,
      });
      expect(
        gameActions({ ...game, state: 2 }, creator, 90, health).respond,
      ).toBe(false);
      expect(
        gameActions({ ...game, state: 3 }, creator, 90, health).reveal,
      ).toBe(false);
      expect(gameActions(game, creator, 101, health).timeout).toBe(false);
      expect(gameTimeLeft(game, 101, health)).toBe("Timeouts paused");
      expect(
        gameActions({ ...game, state: 0 }, creator, 90, health).cancel,
      ).toBe(true);
      expect(
        gameActions({ ...game, state: 0 }, challenger, 101, health).timeout,
      ).toBe(true);
    },
  );
  it.each([1, 2, 3])(
    "extends every unsettled active state %s, including expired unclaimed turns",
    (state) => {
      const health = { ...network, recoveryUntil: 200n };
      const activeGame = { ...game, state };
      expect(effectiveDeadline(activeGame, health)).toBe(200n);
      expect(gameActions(activeGame, creator, 200, health).timeout).toBe(false);
      expect(gameActions(activeGame, creator, 201, health).timeout).toBe(true);
      expect(gameTimeLeft(activeGame, 199, health)).toBe("1s left");
      expect(gameTimeLeft(activeGame, 200, health)).toBe("0s left");
      expect(effectiveDeadline({ ...activeGame, deadline: 300n }, health)).toBe(
        300n,
      );
    },
  );
  it("does not extend open expiry or completed games", () => {
    const health = { ...network, recoveryUntil: 200n };
    for (const state of [0, 4, 5])
      expect(effectiveDeadline({ ...game, state }, health)).toBe(100n);
    expect(
      gameActions({ ...game, state: 0 }, challenger, 101, health).timeout,
    ).toBe(true);
  });
});

it("does not promise timeout protection when RPC health is unknown", () => {
  const unknown = { ...network, status: -1 as const };
  expect(gameTimeLeft(game, 101, unknown)).toContain("deadlines may continue");
  expect(gameTimeLeft(game, 101, unknown)).not.toContain("paused");
  expect(gameActions(game, challenger, 90, unknown)).toMatchObject({
    guess: false,
    concede: false,
    timeout: false,
  });
  expect(gameActions({ ...game, state: 2 }, creator, 90, unknown).respond).toBe(
    false,
  );
  expect(gameActions({ ...game, state: 3 }, creator, 90, unknown).reveal).toBe(
    false,
  );
  expect(gameActions({ ...game, state: 0 }, challenger, 90, unknown).join).toBe(
    false,
  );
  expect(gameActions({ ...game, state: 0 }, creator, 90, unknown).cancel).toBe(
    true,
  );
  expect(
    gameActions({ ...game, state: 0 }, challenger, 101, unknown).timeout,
  ).toBe(true);
});
