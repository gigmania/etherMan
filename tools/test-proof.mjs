import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { encodeAbiParameters, keccak256, toHex, parseEther, parseAbi } from 'viem';
import { startChain, deploy } from './integration.mjs';
import { createProver } from './prover.mjs';
import { dictionaryWitness } from '../web/proof-inputs.ts';

const chain = await startChain();
let prover;
try {
  prover = await createProver();
  const game = await deploy(chain);
  const verifier = await chain.client.readContract({ ...game, functionName: 'dictionaryVerifier' });
  const verifierAbi = parseAbi(['function verify(bytes,bytes32[]) view returns (bool)']);
  const commitment = (r, chainId = BigInt(r.chainId)) => keccak256(encodeAbiParameters(
    [{type:'uint256'}, {type:'address'}, {type:'address'}, {type:'string'}, {type:'bytes32'}],
    [chainId, r.contract, r.creator, r.word, r.salt],
  ));
  const recovery = (word, salt = 1) => {
    const r = { version: 1, chainId: 31337, contract: game.address, creator: chain.accounts[0], word, salt: toHex(BigInt(salt), {size:32}) };
    return { ...r, commitment: commitment(r) };
  };
  const fixture = recovery('cat');
  const { proof, publicInputs } = await prover.prove(fixture);
  const verify = (p, inputs) => chain.client.readContract({address:verifier, abi:verifierAbi, functionName:'verify',args:[p,inputs]});
  assert.equal(await verify(proof, publicInputs), true);
  for (let i=0; i<8; i++) {
    const altered = [...publicInputs]; altered[i] = toHex(BigInt(altered[i])+1n, {size:32});
    let accepted = false;
    try { accepted = await verify(proof, altered); } catch {}
    assert.equal(accepted, false, `Changed public input ${i} must fail verification`);
  }
  console.log('PASS real Solidity proof and rejection of all eight changed public inputs');
  const alteredProof = proof.slice(0,-2) + (proof.endsWith('00') ? '01' : '00');
  const callCreate = (account, p = proof, length = 3, target = game) => chain.client.simulateContract({ ...target, account, functionName:'createGame', args:[fixture.commitment,length,3,p], value:parseEther('0.001') });
  await assert.rejects(() => callCreate(chain.accounts[0],alteredProof));
  await assert.rejects(() => callCreate(chain.accounts[0],'0x'));
  await assert.rejects(() => callCreate(chain.accounts[1]));
  await assert.rejects(() => callCreate(chain.accounts[0],proof,4));
  const other = await deploy(chain);
  await assert.rejects(() => callCreate(chain.accounts[0],proof,3,other));
  assert.equal(await chain.client.readContract({...game,functionName:'nextGameId'}),1n);
  assert.equal(await chain.client.readContract({...game,functionName:'totalEscrow'}),0n);
  assert.equal(await chain.client.readContract({...game,functionName:'usedCommitments',args:[fixture.commitment]}),false);
  console.log('PASS malformed/altered proof, copied wallet/deployment, wrong length, and atomic failure');

  const send = async (functionName, args, value) => {
    const hash=await chain.wallets[0].writeContract({...game,functionName,args,gas:6_000_000n,...(value===undefined?{}:{value})});
    const receipt=await chain.waitForReceipt({hash}); assert.equal(receipt.status,'success'); return receipt;
  };
  const created=await send('createGame',[fixture.commitment,3,3,proof],parseEther('0.001'));
  await assert.rejects(() => callCreate(chain.accounts[0]));
  await send('cancelGame',[1n]);
  await assert.rejects(() => callCreate(chain.accounts[0]));
  const fresh = recovery('cat',2);
  const freshProof = await prover.prove(fresh);
  await send('createGame',[fresh.commitment,3,3,freshProof.proof],parseEther('0.001'));
  console.log('PASS one-use commitment before/after cancellation and new salt for same word');

  const base = dictionaryWitness(fixture,prover.words,prover.tree,prover.manifest.root);
  const execute = input => prover.noir.execute(input);
  const invalid = [
    {...base,word_length:'2'}, {...base,word_length:'13'},
    {...base,word:['67',...base.word.slice(1)]},
    {...base,word:['122','122','122',...base.word.slice(3)]},
    {...base,word:[...base.word.slice(0,3),'1',...base.word.slice(4)]},
    {...base,siblings:['1',...base.siblings.slice(1)]},
    {...base,directions:[!base.directions[0],...base.directions.slice(1)]},
    {...base,commitment_hi:(1n<<128n).toString()},
    {...base,game_contract:(1n<<160n).toString()},
    {...base,creator:(1n<<160n).toString()},
  ];
  for(const input of invalid) await assert.rejects(()=>execute(input));
  const highChain=(1n<<128n)+31337n;
  const hiCommit=BigInt(commitment(fixture,highChain));
  const high={...base,chain_hi:'1',commitment_hi:String(hiCommit>>128n),commitment_lo:String(hiCommit&((1n<<128n)-1n))};
  const {witness: highWitness}=await execute(high);
  const highProof=await prover.backend.generateProof(highWitness,prover.options);
  assert.equal(await verify(toHex(highProof.proof),highProof.publicInputs),true);
  await assert.rejects(()=>callCreate(chain.accounts[0],toHex(highProof.proof))); // Different context cannot reuse it.
  const longest = recovery(prover.words.find(word=>word.length===12),3);
  const boundaryProof=await prover.prove(longest);
  assert.equal(await verify(boundaryProof.proof,boundaryProof.publicInputs),true);
  console.log('PASS real circuit negative cases, high chain limb, and 3/12-character boundaries');
  await writeFile('artifacts/proof-verification-report.json',JSON.stringify({verified:true,publicInputs:8,proofBytes:(proof.length-2)/2,createGas:String(created.gasUsed),root:prover.manifest.root},null,2)+'\n');
  console.log(`Real-proof creation gas: ${created.gasUsed}; no public transactions sent.`);
} finally { await prover?.destroy(); await chain.stop(); }
