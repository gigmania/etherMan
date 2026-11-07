import { deployBundle } from "./deploy-bundle.mjs";
import { createPublicClient, createWalletClient, http } from "viem";
import { foundry } from "viem/chains";

// This script deliberately has no private key or remote-network option.
const url = "http://127.0.0.1:8545";
const client = createPublicClient({ chain: foundry, transport: http(url) });
if ((await client.getChainId()) !== 31337)
  throw new Error("Local chain ID must be 31337.");
const version = await client.request({ method: "web3_clientVersion" });
if (!version.toLowerCase().includes("anvil"))
  throw new Error("This deploy script only supports local Anvil.");
const accounts = await client.request({ method: "eth_accounts" });
if (!accounts[0]) throw new Error("Start npm run chain before deploying.");
const wallet = createWalletClient({
  account: accounts[0],
  chain: foundry,
  transport: http(url),
});
const game = await deployBundle({ client, wallet, waitForReceipt: args => client.waitForTransactionReceipt(args) });
console.log(`Local dictionary-validated EtherMan deployed at ${game.address}`);
console.log(
  `Set in .env.local, then restart Vite:\nVITE_CHAIN_ID=31337\nVITE_RPC_URL=${url}\nVITE_CONTRACT_ADDRESS=${game.address}`,
);
