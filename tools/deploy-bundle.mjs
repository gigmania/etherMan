import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
export async function deployBundle({ client, wallet, waitForReceipt, sequencerUptimeFeed }) {
  // This utility is deliberately local-only, even if a caller supplies a client.
  const url = new URL(client.transport.url);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Deployment must use loopback');
  assert.equal(await client.getChainId(), 31337, 'Deployment must use local chain 31337');
  assert.match(await client.request({ method: 'web3_clientVersion' }), /anvil/i);
  const manifest = JSON.parse(await readFile('dictionary/prover-manifest.json', 'utf8'));
  const addresses = {};
  let game;
  // The mutable feed is a chain-31337-only fixture. Public releases must bind
  // the reviewed network's official uptime proxy, never this simulation.
  const names = [...(sequencerUptimeFeed ? [] : ['LocalSequencerFeed']), 'ZKTranscriptLib', 'RelationsLib', 'HonkVerifier', 'EtherMan'];
  for (const name of names) {
    const artifact = JSON.parse(await readFile(`artifacts/${name}.json`, 'utf8'));
    let bytecode = artifact.bytecode.slice(2);
    for (const libraries of Object.values(artifact.linkReferences ?? {})) {
      for (const [library, references] of Object.entries(libraries)) {
        assert.ok(addresses[library], `Missing library ${library}`);
        for (const { start, length } of references) {
          assert.equal(length, 20);
          bytecode = bytecode.slice(0, start * 2) + addresses[library].slice(2) + bytecode.slice((start + length) * 2);
        }
      }
    }
    assert.match(bytecode, /^[0-9a-fA-F]+$/, 'Unresolved bytecode link');
    const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: `0x${bytecode}`, ...(name === 'EtherMan' ? { args: [addresses.HonkVerifier, manifest.root, sequencerUptimeFeed ?? addresses.LocalSequencerFeed] } : {}) });
    const receipt = await waitForReceipt({ hash });
    assert.equal(receipt.status, 'success');
    assert.ok(receipt.contractAddress);
    addresses[name] = receipt.contractAddress;
    if (name === 'EtherMan') game = { address: receipt.contractAddress, abi: artifact.abi };
  }
  assert.equal(await client.readContract({ ...game, functionName: 'dictionaryRoot' }), manifest.root);
  assert.equal((await client.readContract({ ...game, functionName: 'sequencerUptimeFeed' })).toLowerCase(), (sequencerUptimeFeed ?? addresses.LocalSequencerFeed).toLowerCase());
  return game;
}
