import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { pathToFileURL } from 'node:url'
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, http, keccak256, parseEther, toHex, TransactionReceiptNotFoundError } from 'viem'
import { foundry } from 'viem/chains'
import { foundryBinary } from './foundry.mjs'
import { deployBundle } from './deploy-bundle.mjs'
import { createProver } from './prover.mjs'

/** Isolated, disposable chain. Uses Anvil's unlocked local accounts, never private keys. */
export async function startChain({ scrollFork = false } = {}) {
  const forkArgs = []
  if (scrollFork) {
    // The upstream client only reads. All test transactions use loopback below.
    const upstream = createPublicClient({ transport: http('https://rpc.scroll.io', { timeout: 15000, retryCount: 0 }) })
    assert.equal(await upstream.getChainId(), 534352, 'Fork source must be Scroll mainnet')
    const block = await upstream.getBlockNumber({ cacheTime: 0 })
    // Default Anvil addresses can already have delegated code on the real chain.
    // Fresh local accounts avoid inheriting that code, nonces, or account history.
    forkArgs.push('--fork-url', 'https://rpc.scroll.io', '--fork-block-number', String(block), '--mnemonic-random')
    console.log(`Scroll state fork pinned to block ${block}; transactions execute on local chain 31337.`)
  }
  const reservation = net.createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const url = `http://127.0.0.1:${port}`
  const child = spawn(foundryBinary('anvil'), ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '31337', ...forkArgs, '--silent'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  let spawnError
  child.on('error', error => { spawnError = error })
  child.stderr.on('data', data => { logs += data.toString() })
  child.stdout.on('data', data => { logs += data.toString() })
  const stop = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit').catch(() => {})
    child.kill('SIGTERM')
    const force = setTimeout(() => child.kill('SIGKILL'), 2000)
    await exited
    clearTimeout(force)
  }
  const client = createPublicClient({ chain: foundry, transport: http(url, { retryCount: 0, timeout: scrollFork ? 60000 : 1000 }), pollingInterval: 50 })
  try {
    let ready = false
    for (let i = 0; i < 100; i++) {
      if (spawnError) throw spawnError
      if (child.exitCode !== null) throw new Error(`Anvil exited: ${logs}`)
      try { ready = await client.getChainId() === 31337 } catch {}
      if (ready) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!ready) throw new Error(`Anvil did not start: ${logs}`)
    const accounts = await client.request({ method: 'eth_accounts' })
    const wallets = accounts.slice(0, 4).map(account => createWalletClient({ account, chain: foundry, transport: http(url) }))
    const waitForReceipt = async ({ hash }) => {
      if (!scrollFork) return client.waitForTransactionReceipt({ hash })
      // A fork may expose the new block before its receipt is readable. Anvil
      // mines only on transactions, so waiting for another block can stall.
      // These isolated unlocked-account tests do not replace transactions.
      const deadline = Date.now() + 30000
      do {
        try { return await client.getTransactionReceipt({ hash }) }
        catch (error) { if (!(error instanceof TransactionReceiptNotFoundError)) throw error }
        await new Promise(resolve => setTimeout(resolve, 100))
      } while (Date.now() < deadline)
      throw new Error(`Local fork receipt not found within 30 seconds: ${hash}`)
    }
    return { client, wallets, accounts, url, stop, waitForReceipt }
  } catch (error) { await stop(); throw error }
}

export async function deploy(chain) {
  return deployBundle({ client: chain.client, wallet: chain.wallets[0], waitForReceipt: chain.waitForReceipt })
}

export async function integration(options = {}) {
  const chain = await startChain(options)
  let prover
  try {
    prover = await createProver()
    const contract = await deploy(chain)
    console.log(`Deployed test contract at ${contract.address}`)
    const { client, wallets, accounts } = chain
    const read = (functionName, args = []) => client.readContract({ ...contract, functionName, args })
    const measuredTransactions = []
    let feeScenario
    const send = async (actor, functionName, args = [], value) => {
      const { request } = await client.simulateContract({ ...contract, functionName, args, account: accounts[actor], ...(value === undefined ? {} : { value }) })
      // Browser wallets add a gas margin. Anvil's raw unlocked-account submission
      // otherwise uses the exact latest-block estimate, which can become too low
      // when a changed timestamp turns a no-op deadline SSTORE into a real write.
      const estimated = await client.estimateContractGas({ ...contract, functionName, args, account: accounts[actor], ...(value === undefined ? {} : { value }) })
      const hash = await wallets[actor].writeContract({ ...request, gas: estimated + estimated / 4n + 5000n })
      const receipt = await chain.waitForReceipt({ hash })
      assert.equal(receipt.status, 'success', `${functionName} reverted`)
      if (feeScenario) measuredTransactions.push({ scenario: feeScenario, actor, functionName,
        gasUsed: String(receipt.gasUsed), to: contract.address,
        data: encodeFunctionData({ abi: contract.abi, functionName, args }), value: String(value ?? 0n) })
      return receipt
    }
    const fails = async (actor, functionName, args = [], value, errorName) => {
      await assert.rejects(() => client.simulateContract({ ...contract, functionName, args, account: accounts[actor], ...(value === undefined ? {} : { value }) }), error => {
        assert.match(error.message, new RegExp(errorName), `${functionName} must reject with ${errorName}`)
        return true
      })
    }
    const stake = parseEther('0.001000000000000001')
    let cases = 0
    const checkAccounting = async () => {
      const [escrow, totalCredits, balance, ...credits] = await Promise.all([
        read('totalEscrow'), read('totalCredits'), client.getBalance({ address: contract.address }),
        ...accounts.slice(0, 4).map(account => read('credits', [account])),
      ])
      assert.equal(totalCredits, credits.reduce((sum, credit) => sum + credit, 0n))
      assert.equal(escrow + totalCredits, balance)
    }
    const create = async (word = 'cat', maxMisses = 3, saltNumber = 1) => {
      const salt = toHex(saltNumber, { size: 32 })
      const commitment = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'string' }, { type: 'bytes32' }], [31337n, contract.address, accounts[0], word, salt]))
      assert.equal(await read('computeCommitment', [accounts[0], word, salt]), commitment, 'Frontend-compatible commitment encoding must agree with contract')
      const id = await read('nextGameId')
      const { proof } = await prover.prove({ version: 1, chainId: 31337, contract: contract.address, creator: accounts[0], word, salt, commitment })
      await send(0, 'createGame', [commitment, word.length, maxMisses, proof], stake)
      const game = await read('getGame', [id])
      assert.equal(game.stake, stake, 'Exact wei must survive ABI roundtrip')
      assert.equal(game.commitment, commitment)
      assert.equal(game.finalWord, '', 'Answer is not exposed before reveal')
      await checkAccounting()
      return { id, word, salt }
    }
    const advancePast = async id => {
      const game = await read('getGame', [id])
      await client.request({ method: 'evm_setNextBlockTimestamp', params: [Number(game.deadline + 1n)] })
      await client.request({ method: 'evm_mine' })
    }

    const solved = await create()
    await fails(0, 'joinGame', [solved.id], stake, 'Unauthorized')
    await fails(1, 'joinGame', [solved.id], stake - 1n, 'InvalidStake')
    await fails(1, 'joinGame', [solved.id], stake + 1n, 'InvalidStake')
    // Verify an actual mined underfunded transaction also reverts and preserves escrow.
    const invalidHash = await wallets[1].writeContract({ ...contract, functionName: 'joinGame', args: [solved.id], value: 0n, gas: 300_000n })
    assert.equal((await chain.waitForReceipt({ hash: invalidHash })).status, 'reverted')
    assert.equal((await read('getGame', [solved.id])).state, 0)
    await send(1, 'joinGame', [solved.id], stake)
    await fails(2, 'joinGame', [solved.id], stake, 'InvalidState')
    await fails(2, 'guess', [solved.id, 2], undefined, 'Unauthorized')
    await fails(1, 'guess', [solved.id, 26], undefined, 'InvalidInput')
    for (const [letter, mask] of [[2, 1], [0, 2], [19, 4]]) {
      await send(1, 'guess', [solved.id, letter])
      await fails(2, 'respond', [solved.id, letter, mask], undefined, 'Unauthorized')
      await send(0, 'respond', [solved.id, letter, mask])
    }
    assert.equal((await read('getGame', [solved.id])).state, 3)
    await fails(0, 'reveal', [solved.id, 'dog', solved.salt], undefined, 'InvalidCommitment')
    await send(0, 'reveal', [solved.id, solved.word, solved.salt])
    assert.equal((await read('getGame', [solved.id])).winner.toLowerCase(), accounts[1].toLowerCase())
    assert.equal(await read('credits', [accounts[1]]), stake * 2n)
    await fails(0, 'reveal', [solved.id, solved.word, solved.salt], undefined, 'InvalidState')
    await fails(1, 'guess', [solved.id, 1], undefined, 'InvalidState')
    await fails(2, 'withdrawTo', [accounts[2]], undefined, 'NoCredit')
    const recipientBefore = await client.getBalance({ address: accounts[3] })
    await send(1, 'withdrawTo', [accounts[3]])
    assert.equal(await client.getBalance({ address: accounts[3] }), recipientBefore + stake * 2n)
    assert.equal(await read('credits', [accounts[1]]), 0n)
    await fails(1, 'withdrawTo', [accounts[3]], undefined, 'NoCredit')
    await checkAccounting()
    console.log('PASS real-chain solved game, exact wei, role/stake/terminal restrictions, withdrawal isolation')
    cases++

    const lost = await create('cat', 1, 2)
    await send(1, 'joinGame', [lost.id], stake)
    await send(1, 'guess', [lost.id, 25])
    await send(0, 'respond', [lost.id, 25, 0])
    await send(0, 'reveal', [lost.id, lost.word, lost.salt])
    assert.equal((await read('getGame', [lost.id])).winner.toLowerCase(), accounts[0].toLowerCase())
    await checkAccounting()
    console.log('PASS honest creator win after exhausted misses')
    cases++

    const dishonest = await create('cat', 3, 3)
    await send(1, 'joinGame', [dishonest.id], stake)
    await send(1, 'guess', [dishonest.id, 2])
    await send(0, 'respond', [dishonest.id, 2, 0]) // Creator falsely claims c is absent.
    await fails(1, 'guess', [dishonest.id, 2], undefined, 'AlreadyGuessed')
    await advancePast(dishonest.id)
    await send(2, 'claimTimeout', [dishonest.id])
    assert.equal((await read('getGame', [dishonest.id])).state, 3, 'Challenger inactivity must still require creator proof')
    await send(0, 'reveal', [dishonest.id, dishonest.word, dishonest.salt])
    assert.equal((await read('getGame', [dishonest.id])).winner.toLowerCase(), accounts[1].toLowerCase())
    await checkAccounting()
    console.log('PASS dishonest transcript loses even after challenger timeout')
    cases++

    const unanswered = await create('cat', 3, 4)
    await send(1, 'joinGame', [unanswered.id], stake)
    await send(1, 'guess', [unanswered.id, 0])
    await fails(2, 'claimTimeout', [unanswered.id], undefined, 'NotExpired')
    await advancePast(unanswered.id)
    await send(2, 'claimTimeout', [unanswered.id])
    assert.equal((await read('getGame', [unanswered.id])).winner.toLowerCase(), accounts[1].toLowerCase())
    await fails(0, 'respond', [unanswered.id, 0, 2], undefined, 'InvalidState')
    await checkAccounting()
    console.log('PASS missing creator response refunds pot to challenger, permissionless timeout')
    cases++

    const unrevealed = await create('cat', 3, 5)
    await send(1, 'joinGame', [unrevealed.id], stake)
    await send(1, 'concede', [unrevealed.id])
    await advancePast(unrevealed.id)
    await send(2, 'claimTimeout', [unrevealed.id])
    assert.equal((await read('getGame', [unrevealed.id])).winner.toLowerCase(), accounts[1].toLowerCase())
    await checkAccounting()
    console.log('PASS missing reveal forfeits creator stake even after concession')
    cases++

    const cancelled = await create('cat', 3, 6)
    await send(0, 'cancelGame', [cancelled.id])
    const expired = await create('cat', 3, 7)
    assert.ok(expired.id > cancelled.id, 'Game IDs are never reused')
    await advancePast(expired.id)
    await fails(1, 'joinGame', [expired.id], stake, 'Expired')
    await send(2, 'claimTimeout', [expired.id])
    assert.equal((await read('getGame', [expired.id])).state, 5)
    assert.equal(await read('totalEscrow'), 0n)
    await checkAccounting()
    console.log('PASS cancellation/expiry recover deposits, stable IDs, zero orphaned escrow')
    cases++

    const timing = await create('cat', 3, 8)
    await send(1, 'joinGame', [timing.id], stake)
    const joinedBlock = await client.getBlock()
    const estimate = await client.estimateContractGas({ ...contract, functionName: 'guess', args: [timing.id, 2], account: accounts[1] })
    await client.request({ method: 'evm_setNextBlockTimestamp', params: [Number(joinedBlock.timestamp + 1n)] })
    const paddedHash = await wallets[1].writeContract({ ...contract, functionName: 'guess', args: [timing.id, 2], gas: estimate + estimate / 4n + 5000n })
    const paddedReceipt = await chain.waitForReceipt({ hash: paddedHash })
    assert.equal(paddedReceipt.status, 'success', 'Wallet gas margin must cover timestamp-dependent deadline storage cost')
    assert.equal((await read('getGame', [timing.id])).state, 2)
    await send(0, 'respond', [timing.id, 2, 1])
    await send(1, 'concede', [timing.id])
    await send(0, 'reveal', [timing.id, timing.word, timing.salt])
    await checkAccounting()
    console.log('PASS wallet gas margin covers deadline timestamp advancing between estimation and mining')
    cases++

    const stale = await create('cat', 3, 9)
    await send(1, 'joinGame', [stale.id], stake)
    await send(1, 'guess', [stale.id, 25])
    await send(0, 'respond', [stale.id, 25, 0])
    await send(1, 'guess', [stale.id, 2])
    // A delayed retry of the successful z miss must not answer the new c turn.
    await fails(0, 'respond', [stale.id, 25, 0], undefined, 'InvalidInput')
    const staleHash = await wallets[0].writeContract({ ...contract, functionName: 'respond', args: [stale.id, 25, 0], gas: 300_000n })
    assert.equal((await chain.waitForReceipt({ hash: staleHash })).status, 'reverted')
    const afterRetry = await read('getGame', [stale.id])
    assert.equal(afterRetry.state, 2)
    assert.equal(afterRetry.pendingLetter, 2)
    assert.equal(afterRetry.misses, 1)
    assert.deepEqual(await read('getGuesses', [stale.id]), [[25], [0]])
    await send(0, 'respond', [stale.id, 2, 1])
    const correctResponse = await read('getGame', [stale.id])
    assert.equal(correctResponse.state, 1)
    assert.equal(correctResponse.revealedMask, 1)
    assert.equal(correctResponse.misses, 1)
    await send(1, 'concede', [stale.id])
    await send(0, 'reveal', [stale.id, stale.word, stale.salt])
    assert.equal((await read('getGame', [stale.id])).winner.toLowerCase(), accounts[0].toLowerCase())
    await checkAccounting()
    console.log('PASS stale zero-mask response retry cannot answer a later letter or alter the transcript')
    cases++
    // Complete real-proof games at the source dictionary's boundaries, including
    // repeated letters at positions beyond the former uint16 mask capacity.
    for (const actor of [0, 1]) if (await read('credits', [accounts[actor]]) > 0n) await send(actor, 'withdrawTo', [accounts[actor]])
    const longest = prover.words.reduce((a, b) => a.length >= b.length ? a : b)
    for (const [word, label, salt] of [['aa', 'two-letter-solved', 20], ['congratulations', 'over-twelve-solved', 21], [longest, 'longest-solved', 22]]) {
      assert.ok(prover.words.includes(word))
      feeScenario = label
      const round = await create(word, 3, salt)
      await send(1, 'joinGame', [round.id], stake)
      for (const letter of new Set(word)) {
        const code = letter.charCodeAt(0) - 97
        const mask = [...word].reduce((sum, value, i) => sum + (value === letter ? 2 ** i : 0), 0)
        await send(1, 'guess', [round.id, code])
        await send(0, 'respond', [round.id, code, mask])
      }
      assert.equal((await read('getGame', [round.id])).revealedMask, 2 ** word.length - 1)
      await send(0, 'reveal', [round.id, word, round.salt])
      assert.equal((await read('getGame', [round.id])).winner.toLowerCase(), accounts[1].toLowerCase())
      await send(1, 'withdrawTo', [accounts[1]])
      await checkAccounting()
      console.log(`PASS ${label}: ${word.length} positions, real proof through reveal and withdrawal`)
      cases++
    }
    feeScenario = 'longest-creator-win'
    const longLoss = await create(longest, 1, 23)
    await send(1, 'joinGame', [longLoss.id], stake)
    const absent = [...'abcdefghijklmnopqrstuvwxyz'].find(letter => !longest.includes(letter)).charCodeAt(0) - 97
    await send(1, 'guess', [longLoss.id, absent])
    await send(0, 'respond', [longLoss.id, absent, 0])
    await send(0, 'reveal', [longLoss.id, longest, longLoss.salt])
    assert.equal((await read('getGame', [longLoss.id])).winner.toLowerCase(), accounts[0].toLowerCase())
    await send(0, 'withdrawTo', [accounts[0]])
    await checkAccounting()
    cases++
    await writeFile(`artifacts/game-gas${options.scrollFork ? '-scroll-fork' : ''}.json`, JSON.stringify({
      environment: options.scrollFork ? 'Anvil Scroll state fork; not native Scroll execution' : 'Anvil',
      root: prover.manifest.root, measuredAt: new Date().toISOString(), transactions: measuredTransactions,
    }, null, 2) + '\n')
    console.log(`${cases} integration scenarios passed against disposable Anvil.`)
  } finally { await prover?.destroy(); await chain.stop() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== '--scroll-fork')) {
    throw new Error('Usage: node tools/integration.mjs [--scroll-fork]')
  }
  integration({ scrollFork: args[0] === '--scroll-fork' }).catch(error => { console.error(error.shortMessage ?? error.message); process.exitCode = 1 })
}
