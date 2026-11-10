import { test, expect, type Page } from '@playwright/test'
import { createPublicClient, createWalletClient, http, parseAbi, toFunctionSelector } from 'viem'
import { foundry } from 'viem/chains'

type Fixture = { sequencerFeed: `0x${string}`; rpcUrl: string; accounts: string[]; contract: string; word: string; salt: string; commitment: string }

async function wallet(page: Page, fixture: Fixture, account = 1) {
  await page.addInitScript(({ fixture, account }) => {
    let current = account
    let chainId = '0x7a69'
    let rejectNext = false
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
    const emit = (name: string, value: unknown) => listeners.get(name)?.forEach(listener => listener(value))
    const provider = {
      isMetaMask: true,
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [fixture.accounts[current]]
        if (method === 'eth_chainId') return chainId
        if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }]
        if (method === 'wallet_switchEthereumChain') { chainId = (params?.[0] as { chainId: string }).chainId; emit('chainChanged', chainId); return null }
        if (method === 'eth_sendTransaction' && rejectNext) { rejectNext = false; throw Object.assign(new Error('User rejected request'), { code: 4001 }) }
        if (method === 'eth_sendTransaction') {
          const transaction = params?.[0] as Record<string, unknown>
          if (!transaction.gas) {
            // Emulate a wallet's estimation and safety margin, rather than Anvil's
            // bare exact estimate. Deadline SSTORE cost can change in the next block.
            const estimateResponse = await fetch(fixture.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_estimateGas', params: [transaction] }) })
            const estimate = await estimateResponse.json()
            if (estimate.error) throw Object.assign(new Error(estimate.error.message), estimate.error)
            const gas = BigInt(estimate.result)
            params = [{ ...transaction, gas: `0x${(gas + gas / 4n + 5000n).toString(16)}` }]
          }
        }
        const response = await fetch(fixture.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }) })
        const result = await response.json()
        if (result.error) throw Object.assign(new Error(result.error.message), result.error)
        return result.result
      },
      on: (name: string, listener: (...args: unknown[]) => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(listener) },
      removeListener: (name: string, listener: (...args: unknown[]) => void) => listeners.get(name)?.delete(listener),
    }
    Object.defineProperty(window, 'ethereum', { value: provider, configurable: true })
    Object.assign(window, { __testWallet: {
      reject: () => { rejectNext = true },
      account: (index: number) => { current = index; emit('accountsChanged', [fixture.accounts[current]]) },
      chain: (id: string) => { chainId = id; emit('chainChanged', id) },
    } })
  }, { fixture, account })
}

async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await page.getByRole('button', { name: /MetaMask|Injected/i }).click()
  await expect(page.getByRole('button', { name: /Disconnect wallet/ })).toBeVisible()
}

async function reviewAndContinue(page: Page, timeout = 10_000) {
  await expect(page.getByText('Stake / transaction value', { exact: true })).toBeVisible({ timeout })
  await expect(page.getByText('Estimated execution gas fee', { exact: true })).toBeVisible()
  await expect(page.getByText('Not applicable on this network', { exact: true })).toBeVisible()
  const proceed = page.getByRole('button', { name: 'Continue to wallet', exact: true })
  await expect(proceed).toBeEnabled()
  await proceed.click()
}

test('practice completes locally, prevents repeat guesses, and resets the round', async ({ page }) => {
  const submitted: string[] = []
  page.on('request', request => { if (request.postData()?.includes('eth_sendTransaction')) submitted.push(request.url()) })
  await page.goto('/#practice')
  await expect(page.getByText('Local practice only. No wallet, no transactions, no ETH.')).toBeVisible()
  for (const letter of ['e', 't', 'h', 'r']) await page.getByRole('button', { name: letter, exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Word on the street: you won.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'e', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'New word' }).click()
  await expect(page.getByText('Choose a letter to begin')).toBeVisible()
  for (const letter of ['b', 'c', 'd', 'f', 'g', 'h']) await page.getByRole('button', { name: letter, exact: true }).click()
  await expect(page.getByRole('heading', { name: 'The word was “wallet”.' })).toBeVisible()
  expect(submitted).toEqual([])
})

test('disconnected creator cannot stake or generate a misleading recovery backup', async ({ page }) => {
  await page.goto('/#create')
  await page.getByLabel('Your secret word').fill('garden')
  await expect(page.getByRole('button', { name: 'Download recovery file' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Lock stake & create game' })).toBeDisabled()
  const saved = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  expect(saved).not.toContain('garden')
})

test('mobile and desktop layouts remain within the viewport', async ({ page }) => {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const route of ['', '#practice', '#create', '#rules', '#game/1']) {
      await page.goto(`/${route}`)
      await expect(page.locator('main')).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  }
})

test('fee review prevents submission on cancellation or unavailable estimates', async ({ page, request }) => {
  const fixture: Fixture = await (await request.get('/__e2e-state')).json()
  await wallet(page, fixture)
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto('/#game/1')
  await connect(page)
  const submitted: string[] = []
  page.on('request', request => { if (request.postData()?.includes('eth_sendTransaction')) submitted.push(request.url()) })
  const join = page.getByRole('button', { name: 'Join for 0.001 ETH' })
  await expect(join).toBeEnabled()
  await join.click()
  await expect(page.getByRole('button', { name: 'Continue to wallet' })).toBeEnabled()
  await expect(page.getByText('Stake / transaction value', { exact: true })).toBeVisible()
  await expect(page.getByText('Estimated execution gas fee', { exact: true })).toBeVisible()
  expect(submitted).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/etherman-release-fee-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Cancel transaction', exact: true }).click()
  await expect(join).toBeEnabled()
  expect(submitted).toEqual([])
  const rpcPattern = `${fixture.rpcUrl}/**`
  const failEstimate = async (route: import('@playwright/test').Route) => {
    const payload = route.request().postDataJSON()
    if (payload?.method === 'eth_estimateGas') await route.fulfill({ json: { jsonrpc: '2.0', id: payload.id, error: { code: -32000, message: 'Estimate unavailable' } } })
    else await route.continue()
  }
  await page.route(rpcPattern, failEstimate)
  await join.click()
  await expect(page.getByRole('button', { name: 'Refresh estimate', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Continue to wallet', exact: true })).toBeDisabled()
  expect(submitted).toEqual([])
  await page.unroute(rpcPattern, failEstimate)
  await page.getByRole('button', { name: 'Refresh estimate', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Continue to wallet', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Cancel transaction', exact: true }).click()
  expect(submitted).toEqual([])
  await expect(join).toBeEnabled()
})

test('one-account wallet completes the game across outages, recovery, rejection, chain changes, and reload', async ({ page, request }) => {
  test.setTimeout(60_000)
  const fixture: Fixture = await (await request.get('/__e2e-state')).json()
  await wallet(page, fixture)
  await page.goto('/#game/1')
  await connect(page)
  const join = page.getByRole('button', { name: 'Join for 0.001 ETH' })
  await expect(join).toBeEnabled()
  await page.evaluate(() => (window as any).__testWallet.reject())
  await join.click()
  await reviewAndContinue(page)
  await expect(page.getByRole('alert')).toContainText('Signature declined. No transaction was submitted.')
  await expect(join).toBeEnabled()
  await page.evaluate(() => (window as any).__testWallet.chain('0x1'))
  await expect(join).toBeDisabled()
  await page.getByRole('button', { name: 'Switch network', exact: true }).click()
  await expect(join).toBeEnabled()
  await join.click()
  await reviewAndContinue(page)
  await expect(page.getByRole('heading', { name: 'Your next letter?' })).toBeVisible()
  await expect(page.getByText('Included on-chain', { exact: true })).toBeVisible()
  await expect(page.locator('.transaction-notice')).not.toContainText('Confirmed on-chain')
  await expect(page.locator('.transaction-finality')).toContainText('no Ethereum L1 finality')
  await page.getByRole('button', { name: 'c', exact: true }).click()
  await reviewAndContinue(page)
  await expect(page.getByRole('heading', { name: 'Is there an “C”?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Submit letter positions' })).toHaveCount(0)
  await page.evaluate(() => (window as any).__testWallet.account(0))
  // Loss of this browser's RPC observation is not an on-chain timeout pause.
  const healthSelector = toFunctionSelector('getNetworkStatus()')
  const rpcPattern = `${fixture.rpcUrl}/**`
  const blockHealthRead = async (route: import('@playwright/test').Route) => {
    const payload = route.request().postDataJSON()
    if (payload?.method === 'eth_call' && payload.params?.[0]?.data?.startsWith(healthSelector)) await route.abort()
    else await route.continue()
  }
  await page.route(rpcPattern, blockHealthRead)
  try {
    await expect(page.locator('.network-health')).toContainText('deadlines may continue', { timeout: 15_000 })
    await expect(page.locator('.network-health')).not.toContainText('forfeitures are paused')
    await expect(page.getByRole('button', { name: 'Submit letter positions' })).toHaveCount(0)
    const independent = createPublicClient({ transport: http(fixture.rpcUrl) })
    const actual = await independent.readContract({ address: fixture.contract as `0x${string}`, abi: parseAbi(['function getNetworkStatus() view returns (uint8,uint80,uint256)']), functionName: 'getNetworkStatus' })
    expect(actual[0]).toBe(3)
  } finally {
    await page.unroute(rpcPattern, blockHealthRead)
  }
  await expect(page.getByRole('button', { name: 'Submit letter positions' })).toBeEnabled()
  const testChain = createPublicClient({ chain: foundry, transport: http(fixture.rpcUrl) })
  const feedOwner = createWalletClient({ chain: foundry, account: fixture.accounts[0] as `0x${string}`, transport: http(fixture.rpcUrl) })
  const setDown = async (down: boolean) => {
    const hash = await feedOwner.writeContract({ address: fixture.sequencerFeed, abi: parseAbi(['function setDown(bool)']), functionName: 'setDown', args: [down], gas: 200_000n })
    expect((await testChain.waitForTransactionReceipt({ hash })).status).toBe('success')
  }
  try {
    await setDown(true)
    await expect(page.getByText(/^Network sequencer is down\.?$/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Submit letter positions' })).toHaveCount(0)
    await setDown(false)
    await expect(page.getByText(/^Network recovery detected\.?$/)).toBeVisible()
    await page.getByRole('button', { name: 'Start recovery grace period', exact: true }).click()
    await reviewAndContinue(page)
    await expect(page.getByText(/^Recovery grace period\.?$/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Submit letter positions' })).toBeEnabled()
  } finally {
    // Preserve network readiness for the independent creation scenario if an
    // outage assertion fails; the disposable chain remains shared by this file.
    await setDown(false)
    const hash = await feedOwner.writeContract({ address: fixture.contract as `0x${string}`, abi: parseAbi(['function syncSequencer()']), functionName: 'syncSequencer', gas: 200_000n })
    expect((await testChain.waitForTransactionReceipt({ hash })).status).toBe('success')
  }
  await expect(page.getByLabel('Your secret word (used locally to calculate positions)')).toHaveAttribute('type', 'text')
  await page.getByLabel('Your secret word (used locally to calculate positions)').fill('cat')
  await page.getByRole('button', { name: 'Submit letter positions' }).click()
  await reviewAndContinue(page)
  await expect(page.getByRole('heading', { name: 'Waiting for a guess.' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Game #001.' })).toBeVisible()
  await expect(page.locator('.word-tiles').first()).toHaveAttribute('aria-label', 'c blank blank')
  for (const letter of ['a', 't']) {
    await page.evaluate(() => (window as any).__testWallet.account(1))
    await expect(page.getByRole('heading', { name: 'Your next letter?' })).toBeVisible()
    await page.getByRole('button', { name: letter, exact: true }).click()
    await reviewAndContinue(page)
    await expect(page.getByRole('heading', { name: `Is there an “${letter.toUpperCase()}”?` })).toBeVisible()
    await page.evaluate(() => (window as any).__testWallet.account(0))
    await expect(page.getByRole('button', { name: 'Submit letter positions' })).toBeEnabled()
    await page.getByLabel('Your secret word (used locally to calculate positions)').fill('cat')
    await page.getByRole('button', { name: 'Submit letter positions' }).click()
    await reviewAndContinue(page)
    await expect(page.getByRole('heading', { name: letter === 'a' ? 'Waiting for a guess.' : 'Time to reveal.' })).toBeVisible()
  }
  await page.getByLabel('Original word', { exact: true }).fill(fixture.word)
  await page.getByLabel('Secret salt from your recovery file', { exact: true }).fill(fixture.salt)
  await page.getByRole('button', { name: 'Reveal answer & settle', exact: true }).click()
  await reviewAndContinue(page)
  await expect(page.getByText('GAME SETTLED', { exact: true })).toBeVisible()
  await page.evaluate(() => (window as any).__testWallet.account(1))
  await expect(page.getByRole('heading', { name: 'This round is yours.' })).toBeVisible()
  await expect(page.getByText('READY TO WITHDRAW', { exact: true })).toBeVisible()
  const chain = createPublicClient({ transport: http(fixture.rpcUrl) })
  const readCredits = () => chain.readContract({ address: fixture.contract as `0x${string}`, abi: parseAbi(['function credits(address) view returns (uint256)']), functionName: 'credits', args: [fixture.accounts[1] as `0x${string}`] })
  expect(await readCredits()).toBe(2_000_000_000_000_000n)
  await page.getByRole('button', { name: 'Withdraw ETH', exact: true }).click()
  await reviewAndContinue(page)
  await expect(page.getByText('READY TO WITHDRAW', { exact: true })).toHaveCount(0)
  expect(await readCredits()).toBe(0n)
  await expect(page.getByRole('button', { name: 'Withdraw ETH', exact: true })).toHaveCount(0)
})

test('creator must save recovery before staking and secrets stay out of storage and creation calldata', async ({ page, request }) => {
  test.setTimeout(120_000)
  const fixture: Fixture = await (await request.get('/__e2e-state')).json()
  await wallet(page, fixture, 2)
  await page.goto('/#create')
  await connect(page)
  await page.getByLabel('Your secret word', { exact: true }).fill('ethylenediaminetetraacetates')
  const input = page.getByLabel('Your secret word', { exact: true })
  await expect(input).toHaveAttribute('type', 'text')
  await expect(input).not.toHaveAttribute('maxlength', /./)
  await page.getByRole('button', { name: 'Hide word', exact: true }).click()
  await expect(input).toHaveAttribute('type', 'text')
  await expect(input).toHaveCSS('-webkit-text-security', 'disc')
  await expect(input).toHaveValue('ethylenediaminetetraacetates')
  await page.getByRole('button', { name: 'Show word', exact: true }).click()
  const submit = page.getByRole('button', { name: 'Lock stake & create game' })
  await expect(submit).toBeDisabled()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download recovery file' }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const recovery = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  expect(recovery.word).toBe('ethylenediaminetetraacetates')
  expect(recovery.salt).toMatch(/^0x[0-9a-f]{64}$/)
  expect(recovery.chainId).toBe(31337)
  expect(recovery.creator.toLowerCase()).toBe(fixture.accounts[2].toLowerCase())
  await expect(submit).toBeDisabled()
  await page.getByRole('checkbox', { name: 'I saved the recovery file somewhere private and can open it later.' }).check()
  await expect(submit).toBeEnabled()
  const sent: string[] = []
  page.on('request', req => { if (req.postData()?.includes('eth_sendTransaction')) sent.push(req.postData()!) })
  await submit.click()
  await reviewAndContinue(page, 90_000)
  await expect(page.getByRole('heading', { name: 'Your challenge is waiting.' })).toBeVisible({ timeout: 90_000 })
  await page.setViewportSize({ width: 375, height: 900 })
  await expect(page.locator('.word-tiles').first().locator(':scope > span')).toHaveCount(28)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(sent.length).toBeGreaterThan(0)
  expect(sent.join('')).not.toContain('ethylenediaminetetraacetates')
  expect(sent.join('')).not.toContain(Buffer.from('ethylenediaminetetraacetates').toString('hex'))
  expect(sent.join('')).not.toContain(recovery.salt.slice(2))
  const saved = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  expect(saved).not.toContain('ethylenediaminetetraacetates')
  expect(saved).not.toContain(recovery.salt)
  expect(page.url()).not.toContain(recovery.salt)
  expect(page.url()).not.toContain('ethylenediaminetetraacetates')
})
