import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEther, toHex, encodeAbiParameters, keccak256, parseAbi } from 'viem';
import { startChain, deploy } from './integration.mjs';
import { deployBundle } from './deploy-bundle.mjs';
import { createProver } from './prover.mjs';
const scrollFork=process.argv.includes('--scroll-fork');
const chain=await startChain({scrollFork});
let prover;
try {
  prover=await createProver();
  const game=await deploy(chain);
  const feedAddress=await chain.client.readContract({...game,functionName:'sequencerUptimeFeed'});
  const feed={address:feedAddress,abi:JSON.parse(await readFile('artifacts/LocalSequencerFeed.json','utf8')).abi};
  const read=(name,args=[])=>chain.client.readContract({...game,functionName:name,args});
  const send=async(actor,name,args=[],value,target=game)=>{
    const estimate=await chain.client.estimateContractGas({...target,account:chain.accounts[actor],functionName:name,args,...(value===undefined?{}:{value})});
    const hash=await chain.wallets[actor].writeContract({...target,functionName:name,args,gas:estimate+estimate/4n+5000n,...(value===undefined?{}:{value})});
    const receipt=await chain.waitForReceipt({hash});assert.equal(receipt.status,'success');return receipt;
  };
  const rejects=async(actor,name,args=[],error)=>assert.rejects(()=>chain.client.simulateContract({...game,account:chain.accounts[actor],functionName:name,args}),e=>{assert.match(e.message,new RegExp(error));return true;});
  const advance=async timestamp=>{
    await chain.client.request({method:'evm_setNextBlockTimestamp',params:[Number(timestamp)]});
    await chain.client.request({method:'evm_mine'});
  };
  const stake=parseEther('0.001');
  const create=async saltNumber=>{
    const word='cat',salt=toHex(saltNumber,{size:32});
    const commitment=keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'address'},{type:'string'},{type:'bytes32'}],[31337n,game.address,chain.accounts[0],word,salt]));
    const id=await read('nextGameId');
    const {proof}=await prover.prove({version:1,chainId:31337,contract:game.address,creator:chain.accounts[0],word,salt,commitment});
    await send(0,'createGame',[commitment,word.length,3,proof],stake);
    return{id,word,salt};
  };
  const active=await create(401),open=await create(402);
  await send(1,'joinGame',[active.id],stake);
  await send(1,'guess',[active.id,2]);
  const rawDeadline=(await read('getGame',[active.id])).deadline;
  await send(0,'setDown',[true],undefined,feed);
  assert.equal((await read('getNetworkStatus'))[0],1);
  await advance(rawDeadline+8n*86400n);
  await rejects(2,'claimTimeout',[active.id],'SequencerDown');
  await rejects(0,'respond',[active.id,2,1],'SequencerDown');
  // Open expiration is a refund, so it does not rely on the uptime feed.
  await send(2,'claimTimeout',[open.id]);
  await send(0,'withdrawTo',[chain.accounts[3]]);
  assert.equal((await read('getGame',[open.id])).state,5);
  console.log('PASS real-proof game protects overdue creator during outage; expired lobby refund and withdrawal remain available');

  await send(0,'setDown',[false],undefined,feed);
  assert.equal((await read('getNetworkStatus'))[0],2);
  await rejects(2,'claimTimeout',[active.id],'RecoverySyncRequired');
  const sync=await send(2,'syncSequencer');
  const syncBlock=await chain.client.getBlock({blockNumber:sync.blockNumber});
  const grace=await read('recoveryUntil');
  assert.equal(grace,syncBlock.timestamp+86400n);
  assert.equal((await read('getNetworkStatus'))[0],3);
  await rejects(2,'claimTimeout',[active.id],'NotExpired');
  await send(0,'setDown',[false],undefined,feed); // Same-status heartbeat.
  await send(2,'syncSequencer');
  assert.equal(await read('recoveryUntil'),grace);
  // The creator can answer after the OLD deadline, while recovery grace is active.
  await send(0,'respond',[active.id,2,1]);
  await send(1,'concede',[active.id]);
  await send(0,'reveal',[active.id,active.word,active.salt]);
  assert.equal((await read('getGame',[active.id])).winner.toLowerCase(),chain.accounts[0].toLowerCase());
  await send(0,'withdrawTo',[chain.accounts[3]]);
  assert.equal(await read('totalEscrow'),0n);assert.equal(await read('totalCredits'),0n);
  console.log('PASS permissionless synchronization, heartbeat stability, legitimate response during grace, reveal and full withdrawal');

  // A complete down/up cycle can be missed by the application; the changed
  // healthy round still triggers a fresh grace and protects the next timeout.
  const missed=await create(403);
  await send(1,'joinGame',[missed.id],stake);
  await send(0,'setDown',[true],undefined,feed);
  await advance((await read('getGame',[missed.id])).deadline+86400n);
  await send(0,'setDown',[false],undefined,feed);
  await rejects(2,'claimTimeout',[missed.id],'RecoverySyncRequired');
  await send(1,'guess',[missed.id,2]); // Legitimate action syncs automatically.
  const renewed=await read('recoveryUntil');assert.ok(renewed>grace);
  await advance(renewed+1n);
  await send(2,'claimTimeout',[missed.id]);
  assert.equal((await read('getGame',[missed.id])).winner.toLowerCase(),chain.accounts[1].toLowerCase());
  await send(1,'withdrawTo',[chain.accounts[3]]);
  assert.equal(await read('totalEscrow'),0n);assert.equal(await read('totalCredits'),0n);
  console.log('PASS unseen recovery is detected by round; automatic action synchronization; forfeiture only after full renewed opportunity');

  let official;
  if(scrollFork){
    const proxy='0x45c2b8C204568A03Dc7A2E32B71D67Fe97F908A9';
    const snapshot=await chain.client.readContract({address:proxy,abi:parseAbi(['function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)']),functionName:'latestRoundData'});
    assert.equal(snapshot[1],0n,'Official feed must currently report up for this integration check');
    const officialGame=await deployBundle({client:chain.client,wallet:chain.wallets[0],waitForReceipt:chain.waitForReceipt,sequencerUptimeFeed:proxy});
    const status=await chain.client.readContract({...officialGame,functionName:'getNetworkStatus'});
    assert.equal(status[0],3);assert.equal(status[1],snapshot[0]);
    official={proxy,roundId:String(snapshot[0]),answer:String(snapshot[1]),startedAt:String(snapshot[2]),updatedAt:String(snapshot[3]),boundContract:officialGame.address,status:'Ready on local Scroll state fork'};
    console.log('PASS constructor and contract caller read the actual official Scroll uptime proxy on a local state fork');
  }
  await writeFile(`artifacts/outage-integration${scrollFork?'-scroll-fork':''}.json`,JSON.stringify({passed:true,scenarios:3,chain:'local31337',scrollFork,official,measuredAt:new Date().toISOString()},null,2)+'\n');
} catch(error){console.error(error.shortMessage??error.message);process.exitCode=1;}
finally{await prover?.destroy();await chain.stop();}
