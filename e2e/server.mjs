import { createServer } from 'vite'
import { encodeAbiParameters, keccak256, parseEther, toHex } from 'viem'
import { startChain, deploy } from '../tools/integration.mjs'
import { createProver } from '../tools/prover.mjs'

const chain = await startChain()
let server
let prover
try {
  const contract = await deploy(chain)
  // Test-only fixture. Never reused as a real word or salt.
  const word = 'cat'
  const salt = toHex(101, { size: 32 })
  const commitment = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'string' }, { type: 'bytes32' }], [31337n, contract.address, chain.accounts[0], word, salt]))
  prover = await createProver()
  const { proof } = await prover.prove({version:1,chainId:31337,contract:contract.address,creator:chain.accounts[0],word,salt,commitment})
  await prover.destroy()
  prover = undefined
  const hash = await chain.wallets[0].writeContract({ ...contract, functionName: 'createGame', args: [commitment, 3, 3, proof], value: parseEther('0.001') })
  await chain.client.waitForTransactionReceipt({ hash })
  process.env.VITE_CHAIN_ID = '31337'
  process.env.VITE_RPC_URL = chain.url
  process.env.VITE_CONTRACT_ADDRESS = contract.address
  const sequencerFeed = await chain.client.readContract({ ...contract, functionName: 'sequencerUptimeFeed' })
  const state = { sequencerFeed, rpcUrl: chain.url, accounts: chain.accounts.slice(0, 4), contract: contract.address, word, salt, commitment }
  server = await createServer({
    server: { host: '127.0.0.1', port: 4173, strictPort: true },
    plugins: [{ name: 'test-fixture-only', configureServer(vite) {
      vite.middlewares.use('/__e2e-state', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(state)) })
    } }],
  })
  await server.listen()
} catch (error) { await prover?.destroy(); await chain.stop(); throw error }
let closing = false
const close = async () => {
  if (closing) return
  closing = true
  await server?.close()
  await chain.stop()
  process.exit(0)
}
process.on('SIGTERM', close)
process.on('SIGINT', close)
