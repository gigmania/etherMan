import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { getAddress, isAddress, parseEventLogs, type Hex } from "viem";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Wallet,
  ShieldCheck,
  Clock3,
  Plus,
  LockKeyhole,
  Download,
  RefreshCw,
  X,
  Check,
  Sparkles,
  CircleHelp,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";
import { etherManAbi } from "./generated/etherManAbi";
import { contractAddress, setupIssue, targetChain } from "./config";
import {
  alphabet,
  createRecovery,
  eth,
  gameActions,
  isSameAddress,
  maskFor,
  parseRecovery,
  parseStake,
  roleOf,
  shortAddress,
  timeLeft,
  validateWord,
  visibleWord,
  wordCommitment,
  type Game,
  type Recovery,
} from "./domain";
import {
  TransactionProvider,
  useClock,
  useCredits,
  useDeployment,
  useDictionaryRoot,
  assertDictionaryDeployment,
  useGame,
  useGames,
  useTransaction,
} from "./chain";
import {
  checkDictionaryWord,
  proveDictionaryWord,
  DictionaryError,
  dictionaryErrors,
  type DictionaryProgress,
} from "./dictionary";

function Hangman({
  misses = 0,
  decorative = false,
}: {
  misses?: number;
  decorative?: boolean;
}) {
  return (
    <svg
      className={`hangman-art ${decorative ? "hero-art" : ""}`}
      viewBox="0 0 260 280"
      fill="none"
      aria-label={
        decorative ? "Stylized Hangman illustration" : `${misses} misses`
      }
      role="img"
    >
      <path d="M38 246H215M70 246V38H180V70M70 75L106 38" className="gallows" />
      {(misses > 0 || decorative) && (
        <circle cx="180" cy="94" r="24" className="figure" />
      )}
      {(misses > 1 || decorative) && (
        <path d="M180 118V181" className="figure" />
      )}
      {(misses > 2 || decorative) && (
        <path d="M180 132L146 154" className="figure" />
      )}
      {(misses > 3 || decorative) && (
        <path d="M180 132L214 154" className="figure" />
      )}
      {(misses > 4 || decorative) && (
        <path d="M180 181L151 216" className="figure" />
      )}
      {(misses > 5 || decorative) && (
        <path d="M180 181L209 216" className="figure" />
      )}
      {decorative && (
        <>
          <path
            d="M171 92H173M187 92H189M173 104Q180 109 187 104"
            className="face"
          />
          <circle cx="36" cy="130" r="3" className="spark" />
          <path d="M225 41V55M218 48H232" className="star" />
        </>
      )}
    </svg>
  );
}
function WordTiles({
  letters,
  small = false,
}: {
  letters: readonly string[];
  small?: boolean;
}) {
  return (
    <div
      className={`word-tiles ${small ? "small" : ""}`}
      aria-label={letters.map((l) => l || "blank").join(" ")}
    >
      {letters.map((letter, i) => (
        <span key={i} className={letter ? "filled" : ""}>
          {letter || <span className="tile-line" />}
        </span>
      ))}
    </div>
  );
}
function WalletControl() {
  const { address, chainId, isConnected } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  if (isConnected && address)
    return (
      <div className="wallet-controls">
        {chainId !== targetChain.id && (
          <button
            className="button small warning"
            onClick={() =>
              switchChain.mutate(
                { chainId: targetChain.id },
                {
                  onError: () =>
                    setError(
                      "Network switch declined. Select the network in your wallet.",
                    ),
                },
              )
            }
          >
            Switch network
          </button>
        )}
        <button
          className="button small secondary"
          aria-label={`Disconnect wallet ${shortAddress(address)}`}
          onClick={() => disconnect.mutate()}
        >
          <span className="wallet-dot" />
          {shortAddress(address)}
          <X size={13} />
        </button>
        {error && (
          <span className="wallet-error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  return (
    <div className="wallet-picker">
      <button className="button small" onClick={() => setOpen(!open)}>
        <Wallet size={16} />
        Connect wallet
      </button>
      {open && (
        <div className="wallet-menu">
          <strong>Choose a wallet</strong>
          <p>Your wallet stays in control.</p>
          {connectors.length ? (
            connectors.map((connector) => (
              <button
                className="button secondary"
                key={connector.uid}
                disabled={connect.isPending}
                onClick={() => {
                  setError("");
                  connect.mutate(
                    { connector },
                    {
                      onSuccess: () => setOpen(false),
                      onError: () =>
                        setError(
                          "Connection was declined or no browser wallet is available.",
                        ),
                    },
                  );
                }}
              >
                {connector.name}
                <ArrowUpRight size={16} />
              </button>
            ))
          ) : (
            <p>Install an Ethereum browser wallet to connect.</p>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
function TransactionNotice() {
  const { state, clear, busy } = useTransaction();
  if (state.phase === "idle") return null;
  const explorer = targetChain.blockExplorers?.default.url;
  return (
    <aside
      className={`transaction-notice ${state.phase}`}
      role={state.phase === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <div className="transaction-icon">
        {busy ? (
          <LoaderCircle className="spin" size={21} />
        ) : state.phase === "success" ? (
          <Check size={21} />
        ) : (
          <CircleHelp size={21} />
        )}
      </div>
      <div>
        <strong>{state.label}</strong>
        <p>{state.message}</p>
        {state.hash &&
          (explorer ? (
            <a
              href={`${explorer}/tx/${state.hash}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction <ExternalLink size={12} />
            </a>
          ) : (
            <code className="transaction-hash">{state.hash}</code>
          ))}
      </div>
      {!busy && (
        <button
          className="icon-button"
          aria-label="Dismiss transaction status"
          onClick={clear}
        >
          <X size={17} />
        </button>
      )}
    </aside>
  );
}
function ConnectionNotice() {
  const deployment = useDeployment();
  const { isConnected, chainId } = useConnection();
  if (setupIssue)
    return (
      <div className="connection-note">
        <span className="status-dot amber" />
        <span>
          <strong>Local preview</strong> {setupIssue}
        </span>
      </div>
    );
  if (deployment.isLoading)
    return (
      <div className="connection-note">
        <LoaderCircle size={16} className="spin" />
        Checking the contract connection…
      </div>
    );
  if (deployment.error)
    return (
      <div className="connection-note error">
        <span className="status-dot amber" />
        <span>
          <strong>Connection unavailable.</strong> Check the RPC network and
          deployed contract address, then retry.
        </span>
        <button className="text-button" onClick={() => deployment.refetch()}>
          Retry
        </button>
      </div>
    );
  if (isConnected && chainId !== targetChain.id)
    return (
      <div className="connection-note">
        <span className="status-dot amber" />
        Switch your wallet to {targetChain.name} to play. Transactions are
        disabled on other networks.
      </div>
    );
  return (
    <div className="connection-note">
      <span className="status-dot" />
      <span>
        <strong>
          {targetChain.id === 31337 ? "Local development" : "Sepolia testnet"}.
        </strong>{" "}
        Test ETH only. This version has not been cleared for mainnet.
      </span>
    </div>
  );
}
function useCanTransact() {
  const { isConnected, chainId } = useConnection();
  const deployment = useDeployment();
  return (
    isConnected &&
    chainId === targetChain.id &&
    deployment.data === true &&
    !setupIssue
  );
}
function StatusPill({ game }: { game: Game }) {
  const labels = [
    "Waiting for player",
    "Challenger’s turn",
    "Creator’s turn",
    "Reveal required",
    "Settled",
    "Cancelled",
  ];
  return (
    <span className={`pill state-${game.state}`}>
      <span className="status-dot" />
      {labels[game.state] || "Unknown state"}
    </span>
  );
}
export function Credits() {
  const { address } = useConnection();
  const credits = useCredits();
  const tx = useTransaction();
  const ready = useCanTransact();
  const [recipient, setRecipient] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setRecipient("");
    setError("");
  }, [address]);
  if (!address || !credits.data) return null;
  return (
    <section className="credits-card">
      <div>
        <span className="eyebrow">READY TO WITHDRAW</span>
        <h3>
          {eth(credits.data)} <span>ETH</span>
        </h3>
        <p>
          Settled winnings and refunds are credited to your wallet. Withdraw
          them separately.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !isAddress(recipient || address) ||
            /^0x0{40}$/i.test(recipient || address)
          ) {
            setError("Enter a valid, nonzero Ethereum address.");
            return;
          }
          setError("");
          void tx.run("Withdraw balance", "withdrawTo", [
            getAddress(recipient || address),
          ]);
        }}
      >
        <label htmlFor="withdraw-recipient">
          Recipient (defaults to your wallet)
        </label>
        <input
          id="withdraw-recipient"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder={address}
          spellCheck={false}
        />
        <button className="button" disabled={!ready || tx.busy}>
          Withdraw ETH
          <ArrowUpRight size={16} />
        </button>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
function Lobby() {
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<"all" | "open" | "mine">("all");
  const games = useGames(page);
  const { address } = useConnection();
  const now = useClock();
  const [search, setSearch] = useState("");
  const filtered =
    games.data?.games.filter(
      ({ game }) =>
        filter === "all" ||
        (filter === "open" &&
          game.state === 0 &&
          BigInt(now) <= game.deadline) ||
        (filter === "mine" &&
          (isSameAddress(game.creator, address) ||
            isSameAddress(game.challenger, address))),
    ) || [];
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="status-dot" />
            THE CLASSIC GAME. A NEW KIND OF STAKES.
          </div>
          <h1>
            Good with words?
            <br />
            <span>Put ETH on it.</span>
          </h1>
          <p>
            A battle of wits, one letter at a time. Challenge a friend, keep
            your word secret, and let the contract settle the score.
          </p>
          <div className="hero-actions">
            <a href="#create" className="button">
              Create a game
              <Plus size={18} />
            </a>
            <a href="#practice" className="button secondary">
              Try a practice round
              <ArrowUpRight size={17} />
            </a>
          </div>
          <div className="hero-facts">
            <span>
              <ShieldCheck size={15} />
              On-chain escrow
            </span>
            <span>
              <LockKeyhole size={15} />
              Hidden-word commitment
            </span>
            <span>
              <Clock3 size={15} />
              24-hour turns
            </span>
          </div>
        </div>
        <div className="hero-visual">
          <div className="art-label">
            <span className="status-dot" />A LITTLE WORDPLAY.
          </div>
          <Hangman decorative />
          <WordTiles letters={["e", "t", "h", "e", "r"]} small />
          <span className="art-caption">BIG BRAIN ENERGY.</span>
          <div className="orbit-label">E / M</div>
        </div>
      </section>
      <section className="lobby-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">FIND YOUR NEXT CHALLENGE</span>
            <h2>
              The game room<span className="accent-dot">.</span>
            </h2>
          </div>
          <a href="#create" className="text-button">
            Create a game
            <Plus size={16} />
          </a>
        </div>
        <div className="lobby-toolbar">
          <div className="tabs" aria-label="Game filters">
            {(["all", "open", "mine"] as const).map((f) => (
              <button
                key={f}
                aria-pressed={filter === f}
                className={filter === f ? "active" : ""}
                onClick={() => setFilter(f)}
              >
                {f === "all"
                  ? "All games"
                  : f === "open"
                    ? "Open seats"
                    : "My games"}
              </button>
            ))}
          </div>
          <form
            className="game-search"
            onSubmit={(e) => {
              e.preventDefault();
              if (/^[1-9]\d*$/.test(search) && search.length <= 78)
                window.location.hash = `game/${search}`;
            }}
          >
            <label className="sr-only" htmlFor="find-game">
              Open game by ID
            </label>
            <input
              id="find-game"
              placeholder="Game ID"
              inputMode="numeric"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button aria-label="Open game" className="icon-button">
              <ArrowRight size={17} />
            </button>
          </form>
        </div>
        {games.isLoading ? (
          <div className="empty-state">
            <LoaderCircle className="spin" />
            <h3>Reading the game room…</h3>
            <p>Fetching the latest games from the chain.</p>
          </div>
        ) : games.error ? (
          <div className="empty-state">
            <CircleHelp />
            <h3>The game room couldn’t load</h3>
            <p>Check your RPC connection and try again.</p>
            <button
              className="button secondary"
              onClick={() => games.refetch()}
            >
              Try again
              <RefreshCw size={16} />
            </button>
          </div>
        ) : !filtered.length ? (
          <div className="empty-state">
            <div className="empty-symbol">
              <span>_</span>
              <span>?</span>
              <span>_</span>
            </div>
            <h3>
              {setupIssue
                ? "Your next challenge starts here."
                : filter === "mine"
                  ? "No games for this wallet on this page."
                  : "A quiet room. Make the first move."}
            </h3>
            <p>
              {setupIssue
                ? "Get a feel for the game with a free practice round. On-chain games appear when a contract is connected."
                : "Create a game, share its ID with a friend, and give them a word worth guessing."}
            </p>
            <a
              className="button secondary"
              href={setupIssue ? "#practice" : "#create"}
            >
              {setupIssue ? "Play without a wallet" : "Create a game"}
              <ArrowRight size={17} />
            </a>
          </div>
        ) : (
          <div className="game-grid">
            {filtered.map(({ id, game }) => (
              <a href={`#game/${id}`} className="game-card" key={id.toString()}>
                <div className="game-card-top">
                  <span className="mono">
                    GAME #{id.toString().padStart(3, "0")}
                  </span>
                  <StatusPill game={game} />
                </div>
                <WordTiles letters={Array(game.wordLength).fill("")} small />
                <div className="game-card-stake">
                  <span>
                    {eth(game.stake)} <small>ETH</small>
                  </span>
                  <span>per player</span>
                </div>
                <div className="game-card-meta">
                  <span>{game.wordLength} letters</span>
                  <span>{game.maxMisses} misses</span>
                  <span>
                    {game.state < 4 ? timeLeft(game.deadline, now) : "Complete"}
                  </span>
                </div>
                <div className="game-card-bottom">
                  <span>by {shortAddress(game.creator)}</span>
                  <span>
                    {game.state === 0 ? "Take a seat" : "View game"}
                    <ArrowUpRight size={16} />
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
        {(page > 0 || games.data?.hasOlder) && (
          <div className="pagination">
            <button
              className="button secondary small"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ArrowLeft size={15} />
              Newer
            </button>
            <span>Page {page + 1} · up to 20 games</span>
            <button
              className="button secondary small"
              disabled={!games.data?.hasOlder}
              onClick={() => setPage(page + 1)}
            >
              Older
              <ArrowRight size={15} />
            </button>
          </div>
        )}
      </section>
      <section className="how-strip" id="how">
        <div>
          <span className="eyebrow">SIMPLE RULES. REAL COMMITMENT.</span>
          <h2>
            Words between friends.
            <br />
            Rules on Ethereum.
          </h2>
          <a className="text-button" href="#rules">
            How it works
            <ArrowRight size={17} />
          </a>
        </div>
        <div className="step">
          <span>01</span>
          <h3>Set the challenge</h3>
          <p>
            Choose a secret word, save your recovery file, and lock your stake.
          </p>
        </div>
        <div className="step">
          <span>02</span>
          <h3>Trade guesses</h3>
          <p>
            A friend matches your stake. Guess letters and respond within 24
            hours.
          </p>
        </div>
        <div className="step">
          <span>03</span>
          <h3>Reveal & settle</h3>
          <p>
            The contract checks the answer and responses, then credits the
            winner.
          </p>
        </div>
      </section>
    </>
  );
}
function downloadRecovery(recovery: Recovery) {
  const blob = new Blob([JSON.stringify(recovery, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `etherman-recovery-${recovery.commitment.slice(2, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function CreateGame({ remember }: { remember: (r: Recovery) => void }) {
  const { address, chainId } = useConnection();
  const ready = useCanTransact();
  const tx = useTransaction();
  const dictionary = useDictionaryRoot();
  const root = dictionary.data;
  const [word, setWord] = useState("");
  const [showWord, setShowWord] = useState(true);
  const [stake, setStake] = useState("0.001");
  const [misses, setMisses] = useState(6);
  const [recovery, setRecovery] = useState<Recovery>();
  const usedCommitments = useRef(new Set<Hex>());
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const submitting = useRef(false);
  const [proving, setProving] = useState(false);
  const [proofPhase, setProofPhase] = useState<DictionaryProgress>("loading");
  const generation = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const current = useRef({
    word,
    address,
    chainId,
    root,
    ready,
    recovery,
    saved,
    stake,
    misses,
  });
  current.current = {
    word,
    address,
    chainId,
    root,
    ready,
    recovery,
    saved,
    stake,
    misses,
  };
  useEffect(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = undefined;
    setProving(false);
    setRecovery(undefined);
    setSaved(false);
  }, [word, address, chainId, root]);
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  const prepare = async () => {
    if (preparingRef.current || submitting.current || tx.busy) return;
    preparingRef.current = true;
    setPreparing(true);
    const attemptId = generation.current;
    const snapshot = current.current;
    try {
      try {
        validateWord(word);
        parseStake(stake);
      } catch (e) {
        throw new DictionaryError((e as Error).message);
      }
      if (!ready || !address || !contractAddress || !root)
        throw new DictionaryError(
          "Connect your wallet to a dictionary-enabled deployment first.",
        );
      setError("");
      await checkDictionaryWord(word, root);
      if (
        generation.current !== attemptId ||
        current.current.word !== snapshot.word ||
        current.current.address !== snapshot.address ||
        current.current.chainId !== snapshot.chainId ||
        !current.current.ready
      )
        return;
      const backup = createRecovery(
        targetChain.id,
        contractAddress,
        address,
        word,
      );
      setRecovery(backup);
      setSaved(false);
      downloadRecovery(backup);
    } catch (e) {
      if (generation.current === attemptId)
        setError(
          e instanceof DictionaryError ? e.message : dictionaryErrors.assets,
        );
    } finally {
      preparingRef.current = false;
      setPreparing(false);
    }
  };
  const cancelProof = () => {
    generation.current++;
    controller.current?.abort();
    controller.current = undefined;
    setProving(false);
    setError(dictionaryErrors.cancelled);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || preparingRef.current || tx.busy) return;
    submitting.current = true;
    const attemptId = generation.current;
    const snapshot = current.current;
    try {
      try {
        validateWord(word);
        parseStake(stake);
      } catch (e) {
        throw new DictionaryError((e as Error).message);
      }
      if (
        !ready ||
        !root ||
        !saved ||
        !recovery ||
        usedCommitments.current.has(recovery.commitment) ||
        !address ||
        !isSameAddress(recovery.creator, address) ||
        recovery.word !== word ||
        recovery.chainId !== chainId ||
        !isSameAddress(recovery.contract, contractAddress)
      )
        throw new DictionaryError(
          "Download and confirm your recovery backup first.",
        );
      const attempt = recovery;
      const value = parseStake(stake);
      const isCurrent = () =>
        generation.current === attemptId &&
        current.current.ready &&
        current.current.address === snapshot.address &&
        current.current.chainId === snapshot.chainId &&
        current.current.root === snapshot.root &&
        current.current.word === snapshot.word &&
        current.current.recovery === attempt &&
        current.current.saved &&
        current.current.stake === snapshot.stake &&
        current.current.misses === snapshot.misses;
      setError("");
      setProving(true);
      setProofPhase("loading");
      const abort = new AbortController();
      controller.current = abort;
      const result = await proveDictionaryWord(
        attempt,
        root,
        abort.signal,
        setProofPhase,
      );
      if (!isCurrent() || abort.signal.aborted) return;
      await assertDictionaryDeployment(root);
      if (!isCurrent() || abort.signal.aborted) return;
      controller.current = undefined;
      setProving(false);
      // A timed-out receipt can still mine later. Consume the commitment only
      // after proving, synchronously before asking the wallet to submit it.
      usedCommitments.current.add(attempt.commitment);
      setRecovery(undefined);
      setSaved(false);
      remember(attempt);
      const receipt = await tx.run(
        "Create game",
        "createGame",
        [
          attempt.commitment,
          attempt.word.length,
          snapshot.misses,
          result.proof,
        ],
        value,
      );
      if (receipt) {
        const events = parseEventLogs({
          abi: etherManAbi,
          eventName: "GameCreated",
          logs: receipt.logs,
        });
        const event = events.find((log) =>
          isSameAddress(log.address, contractAddress),
        );
        window.location.hash = event ? `game/${event.args.gameId}` : "";
      }
    } catch (e) {
      if (generation.current === attemptId)
        setError(
          e instanceof DictionaryError ? e.message : dictionaryErrors.proof,
        );
    } finally {
      submitting.current = false;
      if (generation.current === attemptId) {
        controller.current = undefined;
        setProving(false);
      }
    }
  };
  return (
    <section className="page-section">
      <a className="back-link" href="#">
        <ArrowLeft size={16} />
        Back to game room
      </a>
      <div className="page-heading">
        <span className="eyebrow">YOUR WORD. THEIR CHALLENGE.</span>
        <h1>
          Create a game<span className="accent-dot">.</span>
        </h1>
        <p>Pick a word. Back it with a stake. Keep your recovery file safe.</p>
      </div>
      <div className="create-layout">
        <form className="panel create-form" onSubmit={submit}>
          <div className="field">
            <label htmlFor="secret-word">
              Your secret word <LockKeyhole size={14} />
            </label>
            <div className="secret-word-input">
              <input
                id="secret-word"
                type="text"
                name="game-word"
                autoComplete="off"
                data-masked={!showWord}
                autoCapitalize="none"
                spellCheck={false}
                value={word}
                onChange={(e) => setWord(e.target.value)}
                placeholder="A word worth guessing"
                aria-describedby="word-hint"
              />
              <button
                type="button"
                className="text-button word-visibility-toggle"
                aria-controls="secret-word"
                onClick={() => setShowWord((visible) => !visible)}
              >
                {showWord ? "Hide word" : "Show word"}
              </button>
            </div>
            <p id="word-hint">
              Choose a lowercase word from the game dictionary. Your browser
              proves membership without revealing the word.
            </p>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="stake">Stake per player</label>
              <div className="input-unit">
                <input
                  id="stake"
                  inputMode="decimal"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                />
                <span>ETH</span>
              </div>
              <p>Greater than 0, up to 1 ETH. Gas is extra.</p>
            </div>
            <div className="field">
              <label htmlFor="misses">Allowed misses</label>
              <select
                id="misses"
                value={misses}
                onChange={(e) => setMisses(Number(e.target.value))}
              >
                {Array.from({ length: 8 }, (_, i) => (
                  <option value={i + 1} key={i}>
                    {i + 1} {i === 0 ? "miss" : "misses"}
                  </option>
                ))}
              </select>
              <p>Only incorrect letters count.</p>
            </div>
          </div>
          <div className="backup-box">
            <div className="backup-heading">
              <Download size={19} />
              <h3>Save your secret before you stake.</h3>
            </div>
            <p>
              The recovery file contains your word and random salt. You need
              both to reveal. Losing them can forfeit your stake. Keep the file
              private; EtherMan does not store a copy.
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={prepare}
              disabled={!ready || !root || tx.busy || proving || preparing}
            >
              <Download size={16} />
              {preparing
                ? "Checking dictionary…"
                : recovery
                  ? "Generate a new backup"
                  : "Download recovery file"}
            </button>
            {recovery && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={saved}
                  disabled={proving || tx.busy}
                  onChange={(e) => setSaved(e.target.checked)}
                />
                I saved the recovery file somewhere private and can open it
                later.
              </label>
            )}
          </div>
          <div className="form-summary">
            <span>
              Turn deadline<strong>24 hours</strong>
            </span>
            <span>
              Open lobby expires<strong>7 days</strong>
            </span>
            <span>
              Protocol fee<strong>0%</strong>
            </span>
          </div>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {proving && (
            <div role="status" aria-live="polite">
              <p>
                {proofPhase === "loading"
                  ? "Loading private proof tools…"
                  : proofPhase === "verifying"
                    ? "Checking your word proof…"
                    : "Proving your word privately in this browser…"}
              </p>
              <button
                type="button"
                className="text-button"
                onClick={cancelProof}
              >
                Cancel proof
              </button>
            </div>
          )}
          {ready && !root && (
            <p className="form-hint">
              This deployment is not ready for dictionary-validated games.
              Existing games remain accessible.
            </p>
          )}
          <button
            className="button full"
            disabled={
              !ready || !root || !saved || tx.busy || proving || preparing
            }
          >
            Lock stake & create game
            <ArrowRight size={18} />
          </button>
          {!ready && (
            <p className="form-hint">
              A connected wallet on the configured test network is required.
            </p>
          )}
        </form>
        <aside className="create-aside">
          <div className="panel illustration-panel">
            <Hangman decorative />
            <WordTiles letters={Array(word.length || 2).fill("")} small />
          </div>
          <div className="aside-note">
            <ShieldCheck size={21} />
            <div>
              <h3>Both players have a part to play.</h3>
              <p>
                You must respond to each guess and reveal at the end. Incorrect
                responses lose the pot when verified. Missed creator deadlines
                allow the challenger to claim it.
              </p>
            </div>
          </div>
          <a className="text-button" href="#rules">
            Read the complete rules
            <ArrowUpRight size={16} />
          </a>
        </aside>
      </div>
    </section>
  );
}
function Practice() {
  const words = ["ether", "wallet", "planet", "cipher", "garden"];
  const [round, setRound] = useState(0);
  const [guessed, setGuessed] = useState<string[]>([]);
  const word = words[round % words.length];
  const misses = guessed.filter((l) => !word.includes(l)).length;
  const solved = [...word].every((l) => guessed.includes(l));
  const finished = solved || misses >= 6;
  return (
    <section className="page-section">
      <a className="back-link" href="#">
        <ArrowLeft size={16} />
        Back to game room
      </a>
      <div className="page-heading">
        <span className="eyebrow">ZERO STAKES. ALL WORDPLAY.</span>
        <h1>
          A little warm-up<span className="accent-dot">.</span>
        </h1>
        <p>Local practice only. No wallet, no transactions, no ETH.</p>
      </div>
      <div className="practice-layout panel">
        <div className="practice-art">
          <span className="pill">
            <Sparkles size={13} />
            PRACTICE MODE
          </span>
          <Hangman misses={misses} />
          <span className="practice-counter">
            {6 - misses}
            <small>misses remaining</small>
          </span>
        </div>
        <div className="practice-board">
          <span className="eyebrow">
            {finished
              ? solved
                ? "NICELY PLAYED."
                : "ANOTHER ROUND?"
              : "ONE LETTER AT A TIME."}
          </span>
          <h2>
            {finished
              ? solved
                ? "Word on the street: you won."
                : `The word was “${word}”.`
              : "What’s your next guess?"}
          </h2>
          <WordTiles
            letters={[...word].map((l) =>
              guessed.includes(l) || finished ? l : "",
            )}
          />
          <div className="keyboard">
            {[...alphabet].map((letter) => (
              <button
                key={letter}
                disabled={guessed.includes(letter) || finished}
                className={
                  guessed.includes(letter)
                    ? word.includes(letter)
                      ? "hit"
                      : "miss"
                    : ""
                }
                onClick={() => setGuessed([...guessed, letter])}
              >
                {letter}
              </button>
            ))}
          </div>
          <div className="practice-footer">
            <span>
              {guessed.length
                ? `${guessed.length} letters played`
                : "Choose a letter to begin"}
            </span>
            <button
              className="text-button"
              onClick={() => {
                setRound(round + 1);
                setGuessed([]);
              }}
            >
              New word
              <RefreshCw size={15} />
            </button>
          </div>
          <p className="muted small-copy">
            In on-chain games, a real creator answers your guesses. The contract
            verifies those answers when the word is revealed.
          </p>
        </div>
      </div>
    </section>
  );
}
export function GameView({ id, secret }: { id: bigint; secret?: Recovery }) {
  const query = useGame(id);
  const { address } = useConnection();
  const ready = useCanTransact();
  const tx = useTransaction();
  const now = useClock();
  const [word, setWord] = useState("");
  const [salt, setSalt] = useState("");
  const [error, setError] = useState("");
  const [selectedMask, setSelectedMask] = useState(0);
  const [confirmConcede, setConfirmConcede] = useState(false);
  useEffect(() => {
    setWord(secret?.word || "");
    setSalt(secret?.salt || "");
    setError("");
    setSelectedMask(0);
    setConfirmConcede(false);
  }, [id, secret]);
  useEffect(() => setSelectedMask(0), [query.data?.game.pendingLetter]);
  if (query.isLoading)
    return (
      <section className="page-section empty-state">
        <LoaderCircle className="spin" />
        <h2>Opening game #{id.toString()}…</h2>
      </section>
    );
  if (!query.data)
    return (
      <section className="page-section empty-state">
        <CircleHelp />
        <h2>
          {setupIssue
            ? "Connect a contract to open games."
            : "This game could not be loaded."}
        </h2>
        <p>Check the game ID, configured contract, and network.</p>
        <button className="button secondary" onClick={() => query.refetch()}>
          Retry
          <RefreshCw size={16} />
        </button>
        <a className="text-button" href="#">
          Back to game room
        </a>
      </section>
    );
  const {
    game,
    guesses: [letters, masks],
  } = query.data;
  const role = roleOf(game, address);
  const actions = gameActions(game, address, now);
  const tiles = game.finalWord
    ? [...game.finalWord]
    : visibleWord(game.wordLength, letters, masks);
  const loadBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !contractAddress || !address) return;
    try {
      if (file.size > 4096) throw new Error("This recovery file is too large.");
      const recovered = parseRecovery(await file.text(), {
        chainId: targetChain.id,
        contract: contractAddress,
        creator: address,
        commitment: game.commitment,
      });
      setWord(recovered.word);
      setSalt(recovered.salt);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
    event.target.value = "";
  };
  const reveal = async () => {
    try {
      validateWord(word);
      if (!/^0x[0-9a-fA-F]{64}$/.test(salt))
        throw new Error("Enter the 32-byte salt from your recovery file.");
      if (
        !contractAddress ||
        !address ||
        wordCommitment(
          targetChain.id,
          contractAddress,
          address,
          word,
          salt as Hex,
        ) !== game.commitment
      )
        throw new Error(
          "The word and salt do not match this game. Check your recovery file.",
        );
      setError("");
      await tx.run("Reveal answer & settle", "reveal", [id, word, salt]);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const response = () => {
    try {
      let mask = selectedMask;
      if (word) {
        validateWord(word);
        if (word.length !== game.wordLength)
          throw new Error("The word length does not match this game.");
        if (
          salt &&
          (!/^0x[0-9a-fA-F]{64}$/.test(salt) ||
            !contractAddress ||
            !address ||
            wordCommitment(
              targetChain.id,
              contractAddress,
              address,
              word,
              salt as Hex,
            ) !== game.commitment)
        )
          throw new Error(
            "The word and salt do not match this game. Reload the original recovery file before responding.",
          );
        mask = maskFor(word, game.pendingLetter);
      }
      setError("");
      void tx.run("Respond to guess", "respond", [
        id,
        game.pendingLetter,
        mask,
      ]);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const roleLabel =
    role === "spectator"
      ? "Watching"
      : role === "creator"
        ? "You created this game"
        : "You are the challenger";
  return (
    <section className="page-section">
      <a className="back-link" href="#">
        <ArrowLeft size={16} />
        Back to game room
      </a>
      <div className="game-title">
        <div>
          <span className="eyebrow">{roleLabel.toUpperCase()}</span>
          <h1>
            Game #{id.toString().padStart(3, "0")}
            <span className="accent-dot">.</span>
          </h1>
        </div>
        <StatusPill game={game} />
      </div>
      <div className="game-layout">
        <aside className="panel game-sidebar">
          <Hangman misses={Math.ceil((game.misses * 6) / game.maxMisses)} />
          <div className="pot">
            <span className="eyebrow">
              {game.state === 0 || game.state === 5
                ? "CREATOR STAKE"
                : "TOTAL POT"}
            </span>
            <strong>
              {eth(
                game.stake * (game.state === 0 || game.state === 5 ? 1n : 2n),
              )}
              <span> ETH</span>
            </strong>
          </div>
          <dl>
            <div>
              <dt>Stake per player</dt>
              <dd>{eth(game.stake)} ETH</dd>
            </div>
            <div>
              <dt>Misses</dt>
              <dd>
                {game.misses} / {game.maxMisses}
              </dd>
            </div>
            <div>
              <dt>Creator</dt>
              <dd title={game.creator}>{shortAddress(game.creator)}</dd>
            </div>
            <div>
              <dt>Challenger</dt>
              <dd title={game.challenger}>
                {/^0x0{40}$/i.test(game.challenger)
                  ? "Open seat"
                  : shortAddress(game.challenger)}
              </dd>
            </div>
            {game.state < 4 && (
              <div>
                <dt>Deadline</dt>
                <dd>{timeLeft(game.deadline, now)}</dd>
              </div>
            )}
          </dl>
          <button className="text-button" onClick={() => query.refetch()}>
            <RefreshCw size={14} />
            Refresh game
          </button>
        </aside>
        <div className="panel game-board">
          <div className="board-heading">
            <span className="eyebrow">
              {game.wordLength} LETTERS · {game.maxMisses} ALLOWED MISSES
            </span>
            <span className="mono">#{id.toString()}</span>
          </div>
          <WordTiles letters={tiles} />
          {game.state === 0 && (
            <div className="action-section">
              <h2>
                {role === "creator"
                  ? "Your challenge is waiting."
                  : "Think you can crack it?"}
              </h2>
              <p>
                Match the creator’s {eth(game.stake)} ETH stake to play. Each
                player has 24 hours to act. The creator must reveal before a
                verified payout.
              </p>
              {actions.join && (
                <button
                  className="button"
                  disabled={!ready || tx.busy}
                  onClick={() =>
                    tx.run("Join game", "joinGame", [id], game.stake)
                  }
                >
                  Join for {eth(game.stake)} ETH
                  <ArrowRight size={17} />
                </button>
              )}
              {actions.cancel && (
                <button
                  className="button secondary"
                  disabled={!ready || tx.busy}
                  onClick={() => tx.run("Cancel open game", "cancelGame", [id])}
                >
                  Cancel & credit refund
                </button>
              )}
              <p className="small-copy muted">
                Share this page’s URL or game ID. No platform fee; network gas
                is extra.
              </p>
            </div>
          )}
          {game.state === 1 && (
            <div className="action-section">
              <h2>
                {role === "challenger"
                  ? "Your next letter?"
                  : "Waiting for a guess."}
              </h2>
              <p>
                {role === "challenger"
                  ? "Choose an unused letter. The creator will respond with its positions."
                  : "The challenger has until the deadline to guess a letter."}
              </p>
              <div className="keyboard">
                {[...alphabet].map((letter, index) => {
                  const guessed = (game.guessedLetters & (1 << index)) !== 0;
                  const responseIndex = letters.indexOf(index);
                  return (
                    <button
                      key={letter}
                      className={
                        responseIndex >= 0
                          ? masks[responseIndex]
                            ? "hit"
                            : "miss"
                          : ""
                      }
                      disabled={!ready || tx.busy || !actions.guess || guessed}
                      onClick={() =>
                        tx.run(`Guess ${letter.toUpperCase()}`, "guess", [
                          id,
                          index,
                        ])
                      }
                    >
                      {letter}
                    </button>
                  );
                })}
              </div>
              {actions.concede && (
                <div className="concede">
                  {confirmConcede ? (
                    <>
                      <p>
                        End your guesses? The creator must still reveal honestly
                        before receiving the pot.
                      </p>
                      <button
                        className="button secondary small"
                        disabled={!ready || tx.busy}
                        onClick={() =>
                          tx.run("Concede & request reveal", "concede", [id])
                        }
                      >
                        Confirm concession
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setConfirmConcede(false)}
                      >
                        Keep playing
                      </button>
                    </>
                  ) : (
                    <button
                      className="text-button muted"
                      onClick={() => setConfirmConcede(true)}
                    >
                      Concede this round
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {game.state === 2 && (
            <div className="action-section">
              <h2>
                Is there an “{alphabet[game.pendingLetter]?.toUpperCase()}”?
              </h2>
              <p>
                {role === "creator"
                  ? "Respond with every position of the guessed letter. False responses lose the pot when the answer is verified."
                  : "The creator must respond before the deadline. Their response will be checked at the final reveal."}
              </p>
              {actions.respond && (
                <>
                  <div className="field">
                    <label htmlFor="response-word">
                      Your secret word (used locally to calculate positions)
                    </label>
                    <input
                      id="response-word"
                      name="response-game-word"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={word}
                      onChange={(e) => setWord(e.target.value)}
                      placeholder="Enter your original word"
                    />
                    <p>
                      The word stays in this browser until you reveal it.
                      Without a recovery salt, its commitment cannot be checked
                      here; you are responsible for using the original word.
                    </p>
                  </div>
                  {!word && (
                    <div className="position-selector">
                      <p>
                        Or select every matching position. Leave all unselected
                        for a miss.
                      </p>
                      <div>
                        {Array.from({ length: game.wordLength }, (_, i) => (
                          <button
                            className={
                              selectedMask & (1 << i) ? "selected" : ""
                            }
                            key={i}
                            aria-pressed={!!(selectedMask & (1 << i))}
                            onClick={() =>
                              setSelectedMask((selectedMask ^ (1 << i)) >>> 0)
                            }
                          >
                            {i + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    className="button"
                    disabled={!ready || tx.busy}
                    onClick={response}
                  >
                    Submit letter positions
                    <ArrowRight size={17} />
                  </button>
                </>
              )}
            </div>
          )}
          {game.state === 3 && (
            <div className="action-section">
              <h2>Time to reveal.</h2>
              <p>
                {role === "creator"
                  ? "Publish the original word and salt. The contract checks every response and credits the rightful winner."
                  : "The creator must reveal the answer. If they miss the deadline, the challenger can claim the pot."}
              </p>
              {actions.reveal && (
                <>
                  <div className="field">
                    <label htmlFor="reveal-word">Original word</label>
                    <input
                      id="reveal-word"
                      autoComplete="off"
                      spellCheck={false}
                      value={word}
                      onChange={(e) => setWord(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="reveal-salt">
                      Secret salt from your recovery file
                    </label>
                    <input
                      id="reveal-salt"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={salt}
                      onChange={(e) => setSalt(e.target.value)}
                      placeholder="0x…"
                    />
                  </div>
                  <button
                    className="button"
                    disabled={!ready || tx.busy}
                    onClick={reveal}
                  >
                    Reveal answer & settle
                    <ShieldCheck size={17} />
                  </button>
                </>
              )}
            </div>
          )}
          {game.state === 4 && (
            <div className="action-section outcome">
              <div className="outcome-icon">
                <Check size={28} />
              </div>
              <span className="eyebrow">GAME SETTLED</span>
              <h2>
                {isSameAddress(game.winner, address)
                  ? "This round is yours."
                  : `${shortAddress(game.winner)} wins.`}
              </h2>
              <p>
                {eth(game.stake * 2n)} ETH was credited to the winner. Winnings
                can be withdrawn separately using the balance panel.
              </p>
              {!game.finalWord && (
                <p className="small-copy muted">
                  No valid answer was recorded for this settlement.
                </p>
              )}
            </div>
          )}
          {game.state === 5 && (
            <div className="action-section">
              <h2>This challenge is closed.</h2>
              <p>The creator’s stake has been credited for withdrawal.</p>
              <a className="button secondary" href="#">
                Find another game
                <ArrowRight size={17} />
              </a>
            </div>
          )}
          {actions.timeout && (
            <div className="timeout-box">
              <Clock3 size={18} />
              <div>
                <strong>The deadline has passed.</strong>
                <p>
                  {game.state === 1
                    ? "Request the final reveal. The creator must prove their responses before receiving any payout."
                    : game.state === 0
                      ? "Close this expired lobby and credit the creator’s refund."
                      : "Claim the pot for the challenger because the creator missed their deadline."}
                </p>
                <button
                  className="button secondary small"
                  disabled={!ready || tx.busy}
                  onClick={() =>
                    tx.run("Resolve expired turn", "claimTimeout", [id])
                  }
                >
                  {game.state === 1
                    ? "Request final reveal"
                    : game.state === 0
                      ? "Refund expired game"
                      : "Claim timeout"}
                </button>
              </div>
            </div>
          )}
          {role === "creator" && game.state < 4 && (
            <div className="recovery-import">
              <label className="text-button" htmlFor="recovery-file">
                <Download size={15} />
                Load your recovery file
              </label>
              <input
                id="recovery-file"
                type="file"
                accept="application/json,.json"
                onChange={loadBackup}
              />
              <p>Read locally. Never uploaded or saved by EtherMan.</p>
            </div>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {!address && game.state < 4 && (
            <p className="form-hint">
              Connect your wallet to join or take your turn.
            </p>
          )}
          {letters.length > 0 && (
            <div className="transcript">
              <span className="eyebrow">RESPONSE HISTORY</span>
              <div>
                {letters.map((letter, i) => (
                  <span key={letter} className={masks[i] ? "hit" : "miss"}>
                    {alphabet[letter]}
                    <small>{masks[i] ? "hit" : "miss"}</small>
                  </span>
                ))}
              </div>
              <p>
                Responses are provisional until the final reveal verifies the
                full transcript.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
function Rules() {
  return (
    <section className="page-section rules">
      <a className="back-link" href="#">
        <ArrowLeft size={16} />
        Back to game room
      </a>
      <div className="page-heading">
        <span className="eyebrow">KNOW THE GAME BEFORE YOU STAKE.</span>
        <h1>
          A fair word fight<span className="accent-dot">.</span>
        </h1>
        <p>
          Interactive two-player Hangman with escrow and a verifiable final
          answer.
        </p>
      </div>
      {[
        [
          "01",
          "Create & keep your secret",
          "Choose a lowercase word from the game dictionary and 1–8 allowed misses. Your browser privately proves dictionary membership, and the contract checks that proof before opening the game. Download your recovery file before creating the game. It contains the word and salt needed to reveal. Keep it private and backed up; losing it can cost your stake.",
        ],
        [
          "02",
          "Match the stake",
          "A different wallet joins with exactly the same stake, up to 1 ETH per player in this candidate. Anyone with the game ID may join an open game. The creator can cancel before a challenger joins. Open games expire after seven days; anyone can trigger the creator’s refund.",
        ],
        [
          "03",
          "Guess & respond",
          "The challenger guesses one unused letter per turn. The creator responds with all positions of that letter, or none for a miss. Each action gets a 24-hour deadline. Only misses consume the allowance. Responses remain provisional until the final reveal; the creator cannot take the pot simply by claiming you lost.",
        ],
        [
          "04",
          "Reveal & verify",
          "When the word is filled, misses run out, the challenger concedes, or their turn expires, the creator must reveal the original word and salt within 24 hours. The contract verifies the commitment and every response. A dishonest transcript awards the pot to the challenger. Otherwise, filling every position wins for the challenger; exhaustion, concession, or challenger timeout wins for the creator.",
        ],
        [
          "05",
          "Resolve a missed deadline",
          "A creator who misses a response or reveal deadline loses the pot to the challenger when someone calls the timeout action. A challenger timeout first requests a reveal: the creator must still demonstrate honest responses. Deadlines do not execute automatically; someone must submit the transaction and pay gas.",
        ],
        [
          "06",
          "Withdraw your balance",
          "Settlement credits the winner with both stakes. Cancellations credit the creator with their original stake. Withdraw your accumulated balance separately to a valid recipient. This candidate takes no protocol fee. Every on-chain action still costs network gas, and a reverted transaction may also cost gas.",
        ],
      ].map(([number, title, body]) => (
        <article className="rule" key={number}>
          <span>{number}</span>
          <div>
            <h2>{title}</h2>
            <p>{body}</p>
          </div>
        </article>
      ))}
      <div className="connection-note">
        <ShieldCheck size={20} />
        <p>
          This is a local/Sepolia release candidate, not a mainnet release. Test
          ETH only. Contract testing does not replace an independent security
          audit.
        </p>
      </div>
      <a className="button" href="#practice">
        Try the basics for free
        <ArrowRight size={17} />
      </a>
    </section>
  );
}
function useRoute() {
  const [route, setRoute] = useState(window.location.hash.slice(1));
  useEffect(() => {
    const change = () => {
      setRoute(window.location.hash.slice(1));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  return route;
}
function Shell() {
  const route = useRoute();
  const [secrets, setSecrets] = useState<Record<string, Recovery>>({});
  const gameMatch = /^game\/([1-9]\d{0,76})$/.exec(route);
  const gameId = gameMatch ? BigInt(gameMatch[1]) : undefined;
  const gameQuery = useGame(gameId);
  const secret = gameQuery.data
    ? secrets[gameQuery.data.game.commitment]
    : undefined;
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <a href="#" className="brand" aria-label="EtherMan home">
            <span className="brand-mark">
              e<span>m</span>
            </span>
            <span>
              ether<span>man</span>
              <sup>V2</sup>
            </span>
          </a>
          <nav aria-label="Main navigation">
            <a className={!route || gameId ? "current" : ""} href="#">
              Game room
            </a>
            <a
              className={route === "practice" ? "current" : ""}
              href="#practice"
            >
              Practice
            </a>
            <a className={route === "rules" ? "current" : ""} href="#rules">
              How to play
            </a>
          </nav>
          <div className="header-actions">
            <span className="network-label">
              <span className="status-dot" />
              {targetChain.id === 31337 ? "Local network" : "Sepolia"}
            </span>
            <WalletControl />
          </div>
        </div>
      </header>
      <main className="main-container">
        <ConnectionNotice />
        <Credits />
        {route === "create" ? (
          <CreateGame
            remember={(r) =>
              setSecrets((prev) => ({ ...prev, [r.commitment]: r }))
            }
          />
        ) : route === "practice" ? (
          <Practice />
        ) : route === "rules" ? (
          <Rules />
        ) : gameId ? (
          <GameView key={gameId.toString()} id={gameId} secret={secret} />
        ) : route ? (
          <section className="empty-state">
            <h1>That page slipped through.</h1>
            <a className="button secondary" href="#">
              Back to game room
              <ArrowRight size={17} />
            </a>
          </section>
        ) : (
          <Lobby />
        )}
      </main>
      <footer className="site-footer">
        <a href="#" className="footer-brand">
          etherman
        </a>
        <p>Words have value. Make yours count.</p>
        <span>LOCAL / TESTNET CANDIDATE</span>
        <a href="#rules">
          Rules & safety
          <ArrowUpRight size={14} />
        </a>
      </footer>
      <TransactionNotice />
    </>
  );
}
export default function App() {
  return (
    <TransactionProvider>
      <Shell />
    </TransactionProvider>
  );
}
