// Read-only Scroll assessment. Signs only synthetic transactions locally for
// byte-size quotes; never sends a transaction or uses a user's wallet/key.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, http, encodeFunctionData, parseAbi, toHex, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { startChain, deploy } from './integration.mjs';
async function main() {
const client = createPublicClient({ transport: http('https://rpc.scroll.io', { timeout: 30000, retryCount: 1 }) });
assert.equal(await client.getChainId(), 534352);
const block = await client.getBlock();
const blockTag = toHex(block.number);
const gasPrice = await client.getGasPrice();
// Compiler runtime templates contain zero placeholders for constructor
// immutables. Execute constructors on a disposable LOCAL chain, then copy the
// exact initialized runtime and linked addresses into read-only RPC overrides.
const local = await startChain();
let overrides = {}, sizes = {}, addresses = {}, localVerifierGas;
const fixture = JSON.parse(await readFile('artifacts/dictionary-proof.json', 'utf8'));
const abi = parseAbi(['function verify(bytes,bytes32[]) view returns (bool)']);
const data = encodeFunctionData({ abi, functionName:'verify',args:[fixture.proof,fixture.publicInputs] });
try {
  const game = await deploy(local);
  addresses.HonkVerifier = await local.client.readContract({...game,functionName:'dictionaryVerifier'});
  const verifierCode = await local.client.getCode({address:addresses.HonkVerifier});
  const verifierArtifact = JSON.parse(await readFile('artifacts/HonkVerifier.json','utf8'));
  for (const libraries of Object.values(verifierArtifact.deployedLinkReferences)) {
    for (const [library, references] of Object.entries(libraries)) {
      const {start,length}=references[0]; assert.equal(length,20);
      addresses[library]='0x'+verifierCode.slice(2+start*2,2+(start+length)*2);
    }
  }
  for (const [name,address] of Object.entries(addresses)) {
    const artifact=JSON.parse(await readFile(`artifacts/${name}.json`,'utf8'));
    const code=await local.client.getCode({address});
    assert.ok(code?.length>2);
    overrides[address]={code};
    sizes[name]={runtimeBytes:(code.length-2)/2,initBytes:(artifact.bytecode.length-2)/2};
    assert.ok(sizes[name].runtimeBytes<=24576 && sizes[name].initBytes<=49152);
  }
  assert.equal(await local.client.readContract({address:addresses.HonkVerifier,abi,functionName:'verify',args:[fixture.proof,fixture.publicInputs]}),true);
  localVerifierGas=await local.client.estimateGas({to:addresses.HonkVerifier,data});
} finally {await local.stop();}
const call = { to:addresses.HonkVerifier, data, gas:toHex(block.gasLimit) };
const nativeResult = await client.request({method:'eth_call',params:[call,blockTag,overrides]});
assert.equal(BigInt(nativeResult),1n,'Actual linked verifier must accept the real proof');
const changed = [...fixture.publicInputs]; changed[0]=toHex(BigInt(changed[0])+1n,{size:32});
let rejected = false;
try {
  const result=await client.request({method:'eth_call',params:[{...call,data:encodeFunctionData({abi,functionName:'verify',args:[fixture.proof,changed]})},blockTag,overrides]});
  rejected=BigInt(result)===0n;
} catch (error) {
  // A revert is an expected rejection; transport/rate-limit errors are not.
  if (/revert/i.test(error.message)) rejected=true; else throw error;
}
assert.ok(rejected,'Native verifier must reject changed public inputs');
// This public RPC supports eth_call overrides but not estimateGas overrides.
// Bound required call gas to within 1,000 using the identical pinned state.
let low=21000n, high=block.gasLimit;
while (high-low>1000n) {
  const middle=(high+low)/2n;
  try {
    const value=await client.request({method:'eth_call',params:[{...call,gas:toHex(middle)},blockTag,overrides]});
    if (BigInt(value)===1n) high=middle; else low=middle;
  } catch(error) {
    if (/revert|out of gas|gas required/i.test(error.details ?? '')) low=middle; else throw error;
  }
}
const nativeVerifierGas=high;
console.log(`Native Scroll verifier simulation passed; successful gas budget ${nativeVerifierGas} gas.`);
const gasReport = JSON.parse(await readFile('artifacts/game-gas.json','utf8'));
const oracle='0x5300000000000000000000000000000000000002';
const oracleAbi = parseAbi(['function getL1Fee(bytes) view returns (uint256)','function isGalileo() view returns (bool)']);
assert.equal(await client.readContract({address:oracle,abi:oracleAbi,functionName:'isGalileo',blockNumber:block.number}),true);
// Public development key 1; never funded or connected to a sending client.
const syntheticAccount = privateKeyToAccount(toHex(1n,{size:32}));
const transactions=[];
for (const [nonce, tx] of gasReport.transactions.entries()) {
  const gas=BigInt(tx.gasUsed);
  const signed=await syntheticAccount.signTransaction({ chainId:534352,type:'eip1559',nonce,
    to:tx.to,data:tx.data,value:BigInt(tx.value),gas:gas+gas/4n+5000n,
    maxFeePerGas:gasPrice,maxPriorityFeePerGas:0n });
  const l1Fee=await client.readContract({address:oracle,abi:oracleAbi,functionName:'getL1Fee',args:[signed],blockNumber:block.number});
  // Adjust local creation gas by the same verifier call's native/local delta.
  // Other action gas remains a local-EVM model, not native measured receipts.
  const executionGas=gas+(tx.functionName==='createGame'?nativeVerifierGas-localVerifierGas:0n);
  const executionFee=executionGas*gasPrice;
  transactions.push({scenario:tx.scenario,actor:tx.actor,action:tx.functionName,
    localGas:tx.gasUsed,executionGasAllowance:String(executionGas),signedBytes:(signed.length-2)/2,
    executionFeeWei:String(executionFee),rawL1FeeUpperBoundWei:String(l1Fee),totalModeledWei:String(executionFee+l1Fee)});
}
const scenarios={};
for(const tx of transactions) {
  const entry=scenarios[tx.scenario]??={transactions:0,creatorWei:0n,challengerWei:0n,totalWei:0n};
  entry.transactions++; entry.totalWei+=BigInt(tx.totalModeledWei);
  entry[tx.actor===0?'creatorWei':'challengerWei']+=BigInt(tx.totalModeledWei);
}
const report={measuredAt:new Date().toISOString(),chainId:534352,blockNumber:String(block.number),blockGasLimit:String(block.gasLimit),gasPriceWei:String(gasPrice),
  nativeVerifier:{validProof:true,changedRootRejected:true,successfulGasBudget:String(nativeVerifierGas),gasSearchTolerance:1000,localEstimateGas:String(localVerifierGas),calldataBytes:(data.length-2)/2,sizes},
  methodology:'Read-only native eth_call state overrides (gas requirement bounded within 1,000) for actual linked verifier. Whole-game execution model is Anvil measured gas plus the native-minus-local verifier estimate delta on creation; raw signed-RLP getL1Fee is a conservative Galileo data-size upper bound. Snapshot estimate, not a maximum fee or guarantee. Stake principal excluded. No broadcasts.',
  scenarios:Object.fromEntries(Object.entries(scenarios).map(([name,s])=>[name,{transactions:s.transactions,creatorEth:formatEther(s.creatorWei),challengerEth:formatEther(s.challengerWei),totalEth:formatEther(s.totalWei)}])),transactions};
await writeFile('artifacts/scroll-assessment.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({block:report.blockNumber,gasPriceWei:report.gasPriceWei,scenarios:report.scenarios},null,2));

}
main().catch(error => { console.error({name:error.name,shortMessage:error.shortMessage,details:error.details,code:error.code,data:error.data,causeData:error.cause?.data}); process.exitCode=1; });
