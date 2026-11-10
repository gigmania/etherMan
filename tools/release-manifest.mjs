import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { keccak256 } from 'viem';

export const releasePath = 'release/manifest.json';
export const bundleNames = ['LocalSequencerFeed', 'ZKTranscriptLib', 'RelationsLib', 'HonkVerifier', 'EtherMan'];
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => sha256(JSON.stringify(value));
export async function inspectRelease() {
  const sources = {};
  for (const entry of (await readdir('contracts-v2', { recursive: true })).filter(x => x.endsWith('.sol')).sort()) {
    const path = `contracts-v2/${entry}`;
    sources[path] = sha256(await readFile(path));
  }
  const artifacts = {};
  for (const name of bundleNames) {
    const artifact = JSON.parse(await readFile(`artifacts/${name}.json`, 'utf8'));
    assert.equal(artifact.contractName, name);
    assert.equal(artifact.compiler, '0.8.38+commit.1835d247.Emscripten.clang', 'Unexpected compiler build');
    assert.deepEqual(artifact.metadata.settings.optimizer, { enabled: true, runs: 200 });
    assert.equal(artifact.metadata.settings.evmVersion, 'cancun');
    for (const [path, source] of Object.entries(artifact.metadata.sources)) {
      assert.equal(keccak256(await readFile(path)), source.keccak256, `${name} was compiled from a different source: ${path}`);
    }
    artifacts[name] = {
      sha256: jsonHash(artifact),
      sourceName: artifact.sourceName,
      creationSha256: sha256(artifact.bytecode),
      runtimeTemplateSha256: sha256(artifact.deployedBytecode),
      linkReferences: artifact.linkReferences,
      deployedLinkReferences: artifact.deployedLinkReferences,
      immutableReferences: artifact.immutableReferences,
    };
  }
  const prover = JSON.parse(await readFile('dictionary/prover-manifest.json', 'utf8'));
  return {
    schemaVersion: 1,
    compiler: '0.8.38+commit.1835d247.Emscripten.clang',
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'cancun',
    dictionaryRoot: prover.root,
    proverManifestSha256: jsonHash(prover),
    deploymentPolicy: {
      chainId: 31337,
      localFixture: 'LocalSequencerFeed',
      scrollForkUrl: 'https://rpc.scroll.io/',
      scrollUptimeProxy: '0x45c2b8C204568A03Dc7A2E32B71D67Fe97F908A9',
      publicDeploymentEnabled: false,
    },
    sources,
    artifacts,
  };
}
export async function verifyRelease(manifest) {
  manifest ??= JSON.parse(await readFile(releasePath, 'utf8'));
  assert.deepEqual(await inspectRelease(), manifest, 'Release inputs differ from the reviewed manifest; rebuild and review an explicit manifest update');
  const artifacts = Object.fromEntries(await Promise.all(bundleNames.map(async name => [name, JSON.parse(await readFile(`artifacts/${name}.json`, 'utf8'))])));
  // Recheck the exact objects returned to the caller, not just the earlier reads.
  for (const name of bundleNames) assert.equal(jsonHash(artifacts[name]), manifest.artifacts[name].sha256, 'Artifact changed during verification');
  return { manifest, artifacts };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--write'), 'Usage: node tools/release-manifest.mjs [--write]');
  if (process.argv[2] === '--write') {
    await writeFile(releasePath, JSON.stringify(await inspectRelease(), null, 2) + '\n');
    console.log(`Wrote ${releasePath}. Review the diff before accepting this release identity.`);
  } else {
    await verifyRelease();
    console.log('Release artifact, source, compiler, dictionary and feed policy checks passed.');
  }
}
