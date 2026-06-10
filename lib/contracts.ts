import { ethers } from "ethers";

// ---------------------------------------------------------------------------
// LightTable contract config — mirrors the LightMarket lib pattern.
// Deployed RecipeBook on LCAI mainnet.
// ---------------------------------------------------------------------------

export const CHAIN = {
  id: 9200,
  idHex: "0x23f0", // 9200
  name: "Lightchain AI",
  rpc: "https://rpc.mainnet.lightchain.ai",
  explorer: "https://mainnet.lightscan.app",
  symbol: "LCAI",
  decimals: 18,
};

export const CONTRACTS = {
  recipeBook: "0xD55bd722178c22cE776d2b4a09D984feaDA2e870",
};

// Only the fragments the frontend calls. Matches the deployed contract.
export const RECIPE_BOOK_ABI = [
  "function submitRecipe(bytes32 contentHash) payable returns (uint256 id)",
  "function tip(uint256 id) payable",
  "function upvote(uint256 id)",
  "function recipeCount() view returns (uint256)",
  "function getRecipe(uint256 id) view returns (address creator, bytes32 contentHash, uint64 upvotes, uint64 createdAt)",
  "function getRecipes(uint256 start, uint256 count) view returns (tuple(address creator, bytes32 contentHash, uint64 upvotes, uint64 createdAt)[] page)",
  "function hasUpvoted(uint256 id, address voter) view returns (bool)",
  "function platformFeeBps() view returns (uint16)",
  "function postFee() view returns (uint256)",
  "event RecipeSubmitted(uint256 indexed id, address indexed creator, bytes32 contentHash)",
  "event Tipped(uint256 indexed id, address indexed from, address indexed creator, uint256 amount, uint256 fee)",
  "event Upvoted(uint256 indexed id, address indexed voter, uint64 newCount)",
];

// ---------------------------------------------------------------------------
// Providers / signer
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    ethereum?: any;
  }
}

/** Read-only provider straight to the LCAI RPC (no wallet needed for browsing). */
export function getReadProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(CHAIN.rpc, CHAIN.id);
}

/** Browser provider over the injected wallet (MetaMask). */
export function getProvider(): ethers.BrowserProvider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No wallet found. Install MetaMask to continue.");
  }
  return new ethers.BrowserProvider(window.ethereum);
}

export async function getSigner(): Promise<ethers.JsonRpcSigner> {
  const provider = getProvider();
  return provider.getSigner();
}

// ---------------------------------------------------------------------------
// Contract getters
// ---------------------------------------------------------------------------

/** Read-only contract instance (browsing, counts). */
export function getRecipeBookRead(): ethers.Contract {
  return new ethers.Contract(CONTRACTS.recipeBook, RECIPE_BOOK_ABI, getReadProvider());
}

/** Write contract instance bound to the connected signer (submit/tip/upvote). */
export async function getRecipeBookWrite(): Promise<ethers.Contract> {
  const signer = await getSigner();
  return new ethers.Contract(CONTRACTS.recipeBook, RECIPE_BOOK_ABI, signer);
}

// ---------------------------------------------------------------------------
// Chain switching — the wallet_switch / wallet_add pattern from LightMarket
// ---------------------------------------------------------------------------

export async function switchToLCAI(): Promise<void> {
  if (!window.ethereum) throw new Error("No wallet found.");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN.idHex }],
    });
  } catch (err: any) {
    // 4902 = chain not added to the wallet yet
    if (err.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN.idHex,
            chainName: CHAIN.name,
            nativeCurrency: { name: CHAIN.symbol, symbol: CHAIN.symbol, decimals: CHAIN.decimals },
            rpcUrls: [CHAIN.rpc],
            blockExplorerUrls: [CHAIN.explorer],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatLCAI(wei: bigint | string, maxDecimals = 4): string {
  const s = ethers.formatUnits(wei, CHAIN.decimals);
  const n = parseFloat(s);
  if (n === 0) return "0";
  // trim to maxDecimals without trailing zeros
  return n.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
}

export function parseLCAI(amount: string): bigint {
  return ethers.parseUnits(amount, CHAIN.decimals);
}

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function explorerTx(hash: string): string {
  return `${CHAIN.explorer}/tx/${hash}`;
}

export function explorerAddr(addr: string): string {
  return `${CHAIN.explorer}/address/${addr}`;
}
