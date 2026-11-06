import {
  encodeAbiParameters,
  formatEther,
  getAddress,
  isAddress,
  keccak256,
  parseEther,
  type Address,
  type Hex,
} from "viem";

export const alphabet = "abcdefghijklmnopqrstuvwxyz";
export const states = [
  "Open",
  "Challenger turn",
  "Creator response",
  "Reveal required",
  "Settled",
  "Cancelled",
] as const;
export type Game = {
  creator: Address;
  challenger: Address;
  commitment: Hex;
  stake: bigint;
  deadline: bigint;
  wordLength: number;
  maxMisses: number;
  misses: number;
  guessedLetters: number;
  revealedMask: number;
  pendingLetter: number;
  state: number;
  winner: Address;
  finalWord: string;
};
export type Recovery = {
  version: 1;
  chainId: number;
  contract: Address;
  creator: Address;
  word: string;
  salt: Hex;
  commitment: Hex;
};
export function validateWord(word: string) {
  if (!/^[a-z]{3,12}$/.test(word))
    throw new Error(
      "Choose 3–12 lowercase letters, without spaces or punctuation.",
    );
  return word;
}
export function parseStake(value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value))
    throw new Error("Enter an ETH amount with at most 18 decimal places.");
  const stake = parseEther(value);
  if (stake <= 0n || stake > parseEther("1"))
    throw new Error("The stake must be greater than 0 and at most 1 ETH.");
  return stake;
}
export function wordCommitment(
  chainId: number,
  contract: Address,
  creator: Address,
  word: string,
  salt: Hex,
) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "string" },
        { type: "bytes32" },
      ],
      [BigInt(chainId), contract, creator, word, salt],
    ),
  );
}
export function createRecovery(
  chainId: number,
  contract: Address,
  creator: Address,
  word: string,
): Recovery {
  validateWord(word);
  const salt =
    `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
  return {
    version: 1,
    chainId,
    contract,
    creator,
    word,
    salt,
    commitment: wordCommitment(chainId, contract, creator, word, salt),
  };
}
export function parseRecovery(
  text: string,
  expected: {
    chainId: number;
    contract: Address;
    creator: Address;
    commitment?: Hex;
  },
): Recovery {
  if (text.length > 4096) throw new Error("This recovery file is too large.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("This is not a valid recovery JSON file.");
  }
  if (!value || typeof value !== "object")
    throw new Error("This is not an EtherMan recovery file.");
  const r = value as Record<string, unknown>;
  if (
    r.version !== 1 ||
    r.chainId !== expected.chainId ||
    typeof r.contract !== "string" ||
    !isAddress(r.contract) ||
    getAddress(r.contract) !== getAddress(expected.contract) ||
    typeof r.creator !== "string" ||
    !isAddress(r.creator) ||
    getAddress(r.creator) !== getAddress(expected.creator)
  )
    throw new Error(
      "This backup belongs to a different network, contract, or creator wallet.",
    );
  if (
    typeof r.word !== "string" ||
    typeof r.salt !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(r.salt) ||
    typeof r.commitment !== "string"
  )
    throw new Error("The recovery file is incomplete.");
  validateWord(r.word);
  const commitment = wordCommitment(
    expected.chainId,
    expected.contract,
    expected.creator,
    r.word,
    r.salt as Hex,
  );
  if (
    commitment.toLowerCase() !== r.commitment.toLowerCase() ||
    (expected.commitment &&
      commitment.toLowerCase() !== expected.commitment.toLowerCase())
  )
    throw new Error("The backup does not match this game’s commitment.");
  return {
    version: 1,
    ...expected,
    word: r.word,
    salt: r.salt as Hex,
    commitment,
  };
}
export function maskFor(word: string, letter: number) {
  return [...word].reduce(
    (mask, ch, index) => (ch === alphabet[letter] ? mask | (1 << index) : mask),
    0,
  );
}
export function visibleWord(
  length: number,
  letters: readonly number[],
  masks: readonly number[],
) {
  return Array.from({ length }, (_, index) => {
    const guess = masks.findIndex((mask) => (mask & (1 << index)) !== 0);
    return guess < 0 ? "" : alphabet[letters[guess]];
  });
}
export const shortAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
export const eth = (wei: bigint) => formatEther(wei);
export function isSameAddress(a?: string, b?: string) {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
export function roleOf(game: Game, address?: string) {
  return isSameAddress(game.creator, address)
    ? "creator"
    : isSameAddress(game.challenger, address)
      ? "challenger"
      : "spectator";
}
export function gameActions(
  game: Game,
  address: string | undefined,
  now: number,
) {
  const role = roleOf(game, address);
  const expired = BigInt(now) > game.deadline;
  const active = game.state < 4;
  return {
    join: game.state === 0 && !expired && !!address && role === "spectator",
    cancel: game.state === 0 && role === "creator",
    guess: game.state === 1 && !expired && role === "challenger",
    respond: game.state === 2 && !expired && role === "creator",
    reveal: game.state === 3 && !expired && role === "creator",
    concede: game.state === 1 && !expired && role === "challenger",
    timeout: active && expired && !!address,
  };
}
export function timeLeft(deadline: bigint, now: number) {
  const seconds = Number(deadline) - now;
  if (seconds < 0) return "Deadline passed";
  if (seconds < 60) return `${seconds}s left`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m left`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m left`;
}
