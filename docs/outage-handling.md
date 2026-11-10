# Reported sequencer outages and recovery grace

Approved workstream: inspect Scroll outage signals, implement permissionless
recovery grace, test the settlement boundaries, obtain independent security
review, and deploy a fresh local candidate. Public deployment, an administrator
pause, alternative-chain deployment and changes to dictionary/recovery encoding
are outside this workstream. Baseline: `fa4b339`.

## Signal and trust boundary

Chainlink lists Scroll's supported uptime proxy as
`0x45c2b8C204568A03Dc7A2E32B71D67Fe97F908A9`. Existing supported feeds continue
operating despite the notice that no additional networks are being added.
[Official feed documentation](https://docs.chain.link/data-feeds/l2-sequencer-feeds).

Read-only snapshot at Scroll block 35,675,162 on November 10, 2026: round
18446744073709552042, answer 0 (up), startedAt 1794257711, updatedAt 1794258655,
answeredInRound equal to roundId. The proxy's aggregator was
`0x95BcCbBBaCBB7ed224AC2EE38531f2467DF41Ea4`. Its verified source matches the
[pinned Chainlink implementation](https://github.com/smartcontractkit/chainlink/blob/065ef85b5fa52bb4583ebad9e51c20a977b64e7a/contracts/src/v0.8/l2ep/dev/scroll/ScrollSequencerUptimeFeed.sol)
byte-for-byte, SHA256
`110b19c4fa56d1bb0ca5101e8c9073617d5b7a78be61c405fc514269c607f960`.
[Verified deployed source](https://scroll.blockscout.com/api/v2/smart-contracts/0x95BcCbBBaCBB7ed224AC2EE38531f2467DF41Ea4).

The feed records an L1 status timestamp in `startedAt`. A transition creates a
new round; `updatedAt` is set when delivered on L2 and can subsequently change
on same-status heartbeats. Historical down/up rounds 425/426 arrived at the same
L2 timestamp, with the up timestamp 944 seconds earlier. Thus neither timestamp
is used directly as EtherMan's once-per-recovery grace anchor. An old healthy
round is not rejected solely by age: a feed-specific heartbeat SLA has not been
established, and a generic short freshness threshold would block valid operation.

The application trusts the fixed proxy's operators, governance and delivery
path. There is no application feed setter. A proxy phase change is treated as
a new round and conservatively starts grace. The guard protects **reported,
observed** outages; it cannot detect an outage that the feed still reports as
healthy, guarantee transaction inclusion, or prevent selective censorship.
Scroll documents ordered L1 messages ahead of L2 transactions within a block,
but a per-block message limit means no instantaneous-delivery guarantee should
be inferred. [Scroll messaging](https://docs.scroll.io/en/technology/bridge/cross-domain-messaging/).

## Rules

The constructor accepts `(dictionaryVerifier, dictionaryRoot,
sequencerUptimeFeed)`, requires a valid healthy initial feed round and records its
ID. There are no games yet, so the initial round does not create recovery grace.

Feed answers must be 0 or 1, round and timestamps nonzero, timestamps ordered and
not in the future, `answeredInRound == roundId`, and round IDs non-regressing
relative to the application's recorded round. This equality rule is a strict
invariant for the selected uptime deployment, not a general price-feed freshness
rule. Read failure or invalid values mean unavailable.

| Status | Meaning | Effect |
| --- | --- | --- |
| Unavailable (0) | Invalid/unreadable feed | Block new stakes, timed play and active timeout claims |
| Down (1) | Feed reports downtime | Same protection |
| RecoveryPending (2) | Healthy round newer than recorded round | Active timeout claims require synchronization |
| Ready (3) | Healthy recorded round | Play allowed, including during grace; active timeouts use the effective deadline |

Anyone can call `syncSequencer()`. For a new healthy round it records that round
and sets `recoveryUntil = block.timestamp + 24 hours`, emitting
`RecoveryGraceStarted`. Same-round calls and heartbeats cannot renew grace.
A legitimate create/join/guess/respond/concede/reveal transaction also performs
this synchronization atomically. If that transaction fails later, synchronization
rolls back; the explicit synchronization function remains available independently.

For ChallengerTurn, CreatorTurn and AwaitReveal:

```
effectiveDeadline = max(stored turn deadline, recoveryUntil)
```

Players can act at the exact effective deadline; timeout claims require a later
timestamp. A pending recovery round causes an active timeout claim to revert
with `RecoverySyncRequired`, even when the old deadline passed. Synchronization
must happen before that claim can proceed. A pending newer round takes precedence
over an earlier elapsed grace window. Successive unseen down/up cycles are still
detected by the changed healthy round ID.

Recovery grace applies to **all unsettled active games**, including turns already
expired but not claimed before the outage. This intentionally gives those players
another opportunity. Avoiding that effect would require reliable outage-history
processing and additional complexity. Settled games never reopen. Grace is an
opportunity to act, not a reconstruction of every second lost during downtime.

Open lobbies retain their seven-day expiry. Creator cancellation, permissionless
expired-open refunds, existing credit withdrawals, and game/credit reads do not
depend on the uptime feed. Active stakes remain escrowed if the feed stays down
or unavailable indefinitely. There is no administrator escape hatch or automatic
refund that could erase an already determined winner's entitlement.

## Frontend and operations

The UI shows network status and a wallet-triggered synchronization action. It
never sends background transactions. A failed, malformed or pending RPC read is
an unverified observation, distinct from a successfully read contract status of
Unavailable. In that case the UI disables risky actions but warns that deadlines
may continue; another participant with working RPC access may still claim them. It blocks new stakes and timed gameplay
when status is unavailable/down/pending, while preserving safe refunds and
withdrawals. Ready includes the recovery grace period: players must be able to
act during that period. Active countdowns use the effective deadline; open
lobby expiry remains unchanged. Contract checks remain authoritative if the UI
snapshot races a status update.

The local deployment helper uses `LocalSequencerFeed`, a fixture restricted by
its constructor to chain 31337 with owner-controlled simulated transitions. It
must never be a public release oracle. Local Scroll-fork verification also binds
an additional candidate to the actual official proxy. Production release checks
must verify proxy identity and contract immutables, not just code presence.

No existing deployed game is migrated or modified. A fresh contract and matching
UI are required. Rollback restores the prior source and configuration, retaining
the matching old UI for existing games. Dictionary circuit, root, Keccak
commitment format and recovery version 1 remain unchanged.

## Verification

Focused contract tests cover delayed delivery, invalid/down snapshots, exact
deadline boundaries, same-round heartbeats, new/previously unseen recovery rounds,
expired unclaimed turns, transaction ordering and safe refunds/withdrawals.
`node tools/test-outage.mjs` exercises real dictionary proofs through a prolonged
outage, recovery, final reveal and withdrawal. Add `--scroll-fork` to repeat on
a local Scroll state fork and verify the actual uptime proxy through a contract
caller. Browser tests exercise outage status, synchronization and resumed play.
Final test and sequential review evidence is recorded in `verification.md` and
`outage-review.json`. These checks are not an external cryptographic audit or a
mainnet deployment approval.
