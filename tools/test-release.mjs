import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWalletClient, http } from 'viem';
import { foundry } from 'viem/chains';
import { assertDeploymentRuntime, deployBundle, linkBytecode, validateDeploymentClients, validateDeploymentFeed } from './deploy-bundle.mjs';
import { inspectRelease, verifyRelease } from './release-manifest.mjs';
import { startChain } from './integration.mjs';

const account = '0x0000000000000000000000000000000000000001';
function rpc(overrides = {}) {
  return { transport: { type: 'http', url: 'http://127.0.0.1:8545' }, chain: { id: 31337 }, account: { type: 'json-rpc', address: account },
    getChainId: async () => 31337, getAddresses: async () => [account], request: async () => 'anvil/v1.7.1', ...overrides };
}
for (const [name, override, expected] of [
  ['remote wallet', { transport: { type: 'http', url: 'https://rpc.scroll.io' } }, /local HTTP|loopback/],
  ['different local endpoint', { transport: { type: 'http', url: 'http://127.0.0.1:8546' } }, /same local endpoint/],
  ['wrong wallet chain configuration', { chain: { id: 534352 } }, /configuration/],
  ['wrong actual wallet chain', { getChainId: async () => 534352 }, /chain 31337/],
  ['non-Anvil wallet', { request: async () => 'geth' }, /requires Anvil/],
  ['private-key wallet', { account: { type: 'local', address: account } }, /unlocked local account/],
  ['unavailable configured account', { getAddresses: async () => [] }, /not unlocked/],
  ['custom transport', { transport: { type: 'custom' } }, /direct HTTP/],
]) test(`rejects ${name} before deploying`, async () => {
  let sent = false;
  await assert.rejects(deployBundle({ client: rpc(), wallet: rpc({ ...override, deployContract: async () => { sent = true; } }) }), expected);
  assert.equal(sent, false);
});
test('rejects a remote reading client before any RPC call', async () => {
  let called = false;
  await assert.rejects(validateDeploymentClients(rpc({ transport: { type: 'http', url: 'http://example.com' }, getChainId: async () => { called = true; } }), rpc()), /loopback/);
  assert.equal(called, false);
});
test('accepts matching local reader and unlocked wallet', async () => {
  assert.equal(await validateDeploymentClients(rpc(), rpc()), account);
});
test('rejects unreviewed or non-fork uptime feeds', async () => {
  const { manifest } = await verifyRelease();
  const policy = manifest.deploymentPolicy;
  await assert.rejects(validateDeploymentFeed(rpc(), account, policy), /reviewed Scroll uptime proxy/);
  await assert.rejects(validateDeploymentFeed(rpc({ request: async () => ({ forkConfig: {} }) }), policy.scrollUptimeProxy, policy), /requires a Scroll fork/);
  await assert.rejects(validateDeploymentFeed(rpc({ request: async () => ({ forkConfig: { forkUrl: 'https://example.com', forkBlockNumber: 10 } }) }), policy.scrollUptimeProxy, policy), /reviewed Scroll fork source/);
});
test('rejects mismatched immutable runtime and missing linked libraries', () => {
  assert.throws(() => assertDeploymentRuntime('0x6001', '0x6002', 'Verifier'), /runtime differs/);
  assert.throws(() => assertDeploymentRuntime('0x', '0x', 'Verifier'), /no runtime/);
  assert.throws(() => linkBytecode('0x' + '00'.repeat(20), { source: { Library: [{ start: 0, length: 20 }] } }, {}), /Missing library/);
});
test('release check rejects altered dictionary, bytecode, settings, links and stale sources', async () => {
  const originalCwd = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), 'etherman-release-'));
  try {
    for (const path of ['contracts-v2', 'artifacts', 'dictionary/prover-manifest.json', 'release/manifest.json']) {
      await mkdir(join(directory, path, '..'), { recursive: true });
      await cp(path, join(directory, path), { recursive: true });
    }
    process.chdir(directory);
    await verifyRelease();
    const alter = async (path, mutation) => {
      const before = await readFile(path, 'utf8');
      try { await writeFile(path, mutation(before)); await assert.rejects(verifyRelease()); }
      finally { await writeFile(path, before); }
    };
    const json = mutation => text => { const object = JSON.parse(text); mutation(object); return JSON.stringify(object); };
    await alter('dictionary/prover-manifest.json', json(value => { value.root = '0x' + '01'.repeat(32); }));
    await alter('artifacts/EtherMan.json', json(value => { value.bytecode += '00'; }));
    await alter('artifacts/HonkVerifier.json', json(value => { value.immutableReferences = {}; }));
    await alter('artifacts/HonkVerifier.json', json(value => { value.linkReferences = {}; }));
    await alter('artifacts/EtherMan.json', json(value => { value.metadata.settings.optimizer.runs = 1; }));
    await alter('contracts-v2/EtherMan.sol', text => text + '\n// stale compiler input\n');
    const source = await readFile('contracts-v2/EtherMan.sol', 'utf8');
    try {
      await writeFile('contracts-v2/EtherMan.sol', source + '\n// changed source\n');
      await assert.rejects(inspectRelease(), /compiled from a different source/);
    } finally { await writeFile('contracts-v2/EtherMan.sol', source); }
  } finally { process.chdir(originalCwd); await rm(directory, { recursive: true, force: true }); }
});
test('deploys and checks the full real bundle on disposable Anvil', async () => {
  const chain = await startChain();
  try {
    const wrong = createWalletClient({ account: chain.accounts[0], chain: { ...foundry, id: 1 }, transport: http(chain.url) });
    await assert.rejects(deployBundle({ client: chain.client, wallet: wrong, waitForReceipt: chain.waitForReceipt }), /configuration/);
    assert.equal(await chain.client.getTransactionCount({ address: chain.accounts[0] }), 0);
    const game = await deployBundle({ client: chain.client, wallet: chain.wallets[0], waitForReceipt: chain.waitForReceipt });
    assert.equal(await chain.client.readContract({ ...game, functionName: 'nextGameId' }), 1n);
    assert.equal((await chain.client.readContract({ ...game, functionName: 'getNetworkStatus' }))[0], 3);
    assert.equal(await chain.client.getTransactionCount({ address: chain.accounts[0] }), 5);
  } finally { await chain.stop(); }
});
