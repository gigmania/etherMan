import assert from 'node:assert/strict';
import { encodeDeployData, getContractAddress, isAddress } from 'viem';
import { verifyRelease } from './release-manifest.mjs';

function endpoint(client) {
  assert.equal(client.transport.type, 'http', 'Deployment requires a direct HTTP transport');
  const url = new URL(client.transport.url);
  assert.equal(url.protocol, 'http:', 'Deployment must use local HTTP');
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Deployment must use loopback');
  assert(!url.username && !url.password && !url.search && !url.hash, 'Deployment endpoint must not contain credentials or parameters');
  assert.equal(client.chain?.id, 31337, 'Client configuration must use local chain 31337');
  return url.href;
}
export async function validateDeploymentClients(client, wallet) {
  assert.equal(endpoint(client), endpoint(wallet), 'Reader and wallet must use the same local endpoint');
  for (const rpc of [client, wallet]) {
    assert.equal(await rpc.getChainId(), 31337, 'Deployment must use local chain 31337');
    assert.match(await rpc.request({ method: 'web3_clientVersion' }), /anvil/i, 'Deployment requires Anvil');
  }
  assert.equal(wallet.account?.type, 'json-rpc', 'Deployment uses an unlocked local account, never a private key');
  const account = wallet.account.address;
  assert(isAddress(account), 'Invalid local account');
  const accounts = await wallet.getAddresses();
  assert(accounts.some(address => address.toLowerCase() === account.toLowerCase()), 'Configured account is not unlocked locally');
  return account;
}
export async function validateDeploymentFeed(client, feed, policy) {
  if (!feed) return;
  assert.equal(feed.toLowerCase(), policy.scrollUptimeProxy.toLowerCase(), 'Only the reviewed Scroll uptime proxy is allowed as an external feed');
  const node = await client.request({ method: 'anvil_nodeInfo' });
  assert(node.forkConfig?.forkUrl, 'The external uptime proxy requires a Scroll fork');
  assert.equal(new URL(node.forkConfig.forkUrl).href, policy.scrollForkUrl, 'External feed requires the reviewed Scroll fork source');
  assert(node.forkConfig.forkBlockNumber != null, 'Scroll fork block must be recorded');
  const code = await client.getCode({ address: feed });
  assert(code && code !== '0x', 'The uptime proxy is absent from this fork');
}
export function linkBytecode(bytecode, references, addresses) {
  let result = bytecode.slice(2);
  for (const libraries of Object.values(references)) {
    for (const [library, positions] of Object.entries(libraries)) {
      assert(isAddress(addresses[library] ?? ''), `Missing library ${library}`);
      for (const { start, length } of positions) {
        assert.equal(length, 20);
        assert(start >= 0 && (start + length) * 2 <= result.length, 'Invalid link position');
        result = result.slice(0, start * 2) + addresses[library].slice(2) + result.slice((start + length) * 2);
      }
    }
  }
  assert.match(result, /^[0-9a-fA-F]+$/, 'Unresolved bytecode link');
  return `0x${result}`;
}
export function assertDeploymentRuntime(actual, expected, name) {
  assert(expected && expected !== '0x', `${name} constructor simulation returned no runtime`);
  assert.equal(actual?.toLowerCase(), expected.toLowerCase(), `${name} deployed runtime differs from the reviewed constructor output`);
}
export async function deployBundle({ client, wallet, waitForReceipt, sequencerUptimeFeed }) {
  // Complete every policy/artifact check before the first transaction.
  const account = await validateDeploymentClients(client, wallet);
  const { manifest, artifacts } = await verifyRelease();
  await validateDeploymentFeed(client, sequencerUptimeFeed, manifest.deploymentPolicy);
  const addresses = {};
  const names = [...(sequencerUptimeFeed ? [] : ['LocalSequencerFeed']), 'ZKTranscriptLib', 'RelationsLib', 'HonkVerifier', 'EtherMan'];
  let game;
  for (const name of names) {
    await validateDeploymentClients(client, wallet);
    const artifact = artifacts[name];
    const bytecode = linkBytecode(artifact.bytecode, artifact.linkReferences, addresses);
    const args = name === 'EtherMan' ? [addresses.HonkVerifier, manifest.dictionaryRoot, sequencerUptimeFeed ?? addresses.LocalSequencerFeed] : [];
    const data = encodeDeployData({ abi: artifact.abi, bytecode, args });
    const nonce = await client.getTransactionCount({ address: account, blockTag: 'latest' });
    assert.equal(await client.getTransactionCount({ address: account, blockTag: 'pending' }), nonce, 'Local deployer has pending transactions');
    const expectedAddress = getContractAddress({ from: account, nonce: BigInt(nonce) });
    // eth_call executes the pinned creation code without persisting state. It
    // returns initialized runtime, including verifier immutables and library
    // self-address guards. Exact comparison below never masks immutable bytes.
    const expectedRuntime = await client.request({ method: 'eth_call', params: [{ from: account, data }, 'latest'] });
    assert(expectedRuntime && expectedRuntime !== '0x', 'Constructor simulation returned no runtime');
    await validateDeploymentClients(client, wallet);
    assert.equal(await client.getTransactionCount({ address: account, blockTag: 'pending' }), nonce, 'Local deployer nonce changed during preflight');
    const hash = await wallet.deployContract({ abi: artifact.abi, bytecode, args, nonce });
    const receipt = await waitForReceipt({ hash });
    assert.equal(receipt.transactionHash.toLowerCase(), hash.toLowerCase(), 'Unexpected deployment receipt');
    assert.equal(receipt.status, 'success');
    assert.equal(receipt.contractAddress?.toLowerCase(), expectedAddress.toLowerCase(), 'Unexpected deployed address');
    const transaction = await client.getTransaction({ hash });
    assert.equal(transaction.from.toLowerCase(), account.toLowerCase(), 'Unexpected deployer');
    assert.equal(transaction.to, null, 'Deployment was replaced by a call');
    assert.equal(transaction.input.toLowerCase(), data.toLowerCase(), 'Deployment creation code or arguments changed');
    assert.equal(transaction.value, 0n, 'Deployment must not transfer value');
    assert.equal(transaction.nonce, nonce, 'Deployment nonce changed');
    assertDeploymentRuntime(await client.getCode({ address: expectedAddress }), expectedRuntime, name);
    addresses[name] = expectedAddress;
    if (name === 'EtherMan') game = { address: expectedAddress, abi: artifact.abi };
  }
  assert.equal(await client.readContract({ ...game, functionName: 'dictionaryRoot' }), manifest.dictionaryRoot);
  assert.equal((await client.readContract({ ...game, functionName: 'dictionaryVerifier' })).toLowerCase(), addresses.HonkVerifier.toLowerCase());
  assert.equal((await client.readContract({ ...game, functionName: 'sequencerUptimeFeed' })).toLowerCase(), (sequencerUptimeFeed ?? addresses.LocalSequencerFeed).toLowerCase());
  return game;
}
