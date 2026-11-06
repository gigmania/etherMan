import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { foundry, sepolia } from "wagmi/chains";
import { createPublicClient, getAddress, isAddress, type Address } from "viem";

const selected = Number(import.meta.env.VITE_CHAIN_ID || 31337);
export const targetChain = selected === sepolia.id ? sepolia : foundry;
export const networkAllowed =
  selected === foundry.id || selected === sepolia.id;
const configuredAddress = import.meta.env.VITE_CONTRACT_ADDRESS as
  string | undefined;
export const contractAddress: Address | undefined =
  configuredAddress && isAddress(configuredAddress)
    ? getAddress(configuredAddress)
    : undefined;
export const setupIssue = !networkAllowed
  ? "This candidate supports Local Anvil and Sepolia only. Mainnet transactions are disabled."
  : configuredAddress && !contractAddress
    ? "The configured contract address is invalid."
    : !contractAddress
      ? "No contract is connected. Explore practice mode, or configure a local deployment to play on-chain."
      : undefined;
export const rpcUrl =
  (import.meta.env.VITE_RPC_URL as string | undefined) ||
  (targetChain.id === foundry.id
    ? "http://127.0.0.1:8545"
    : "https://ethereum-sepolia-rpc.publicnode.com");
export const publicClient = createPublicClient({
  chain: targetChain,
  transport: http(rpcUrl),
  batch: { multicall: false },
});
export const wagmiConfig = createConfig({
  chains: [targetChain],
  connectors: [injected()],
  transports: { [foundry.id]: http(rpcUrl), [sepolia.id]: http(rpcUrl) },
});
