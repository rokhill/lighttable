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

// ---------------------------------------------------------------------------
// Active wallet provider.
//
// The app can connect through TWO kinds of wallet:
//   1. Injected (desktop MetaMask / browser extension) — window.ethereum
//   2. WalletConnect (mobile wallets via QR / deep-link)
//
// We keep a single "active EIP-1193 provider" reference. Everything downstream
// (getSigner, getRecipeBookWrite, switchToLCAI, balance reads) uses whichever
// is active, so the rest of the app doesn't care which kind it is — it always
// gets a normal ethers signer.
// ---------------------------------------------------------------------------

// The raw EIP-1193 provider currently in use (injected object or WC provider).
let activeEip1193: any = null;

/** The WalletConnect Project ID. Public by design (ships in client code). */
const WC_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "00ec98e22aae6c43c00e7a3fa1e77252";

/** Read-only provider straight to the LCAI RPC (no wallet needed for browsing). */
export function getReadProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(CHAIN.rpc, CHAIN.id);
}

/** True if a desktop/extension wallet is injected in this browser. */
export function hasInjected(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

/** Connect via the injected wallet (MetaMask extension). Sets it active. */
export async function connectInjected(): Promise<void> {
  if (!hasInjected()) {
    throw new Error("No browser wallet found. Use WalletConnect, or install MetaMask.");
  }
  await window.ethereum.request({ method: "eth_requestAccounts" });
  activeEip1193 = window.ethereum;
}

/** Connect via WalletConnect (mobile wallets, QR / deep-link). Sets it active. */
export async function connectWalletConnect(): Promise<void> {
  // Dynamic import keeps this large dependency out of the initial bundle and
  // off the server — it only loads when a user actually picks WalletConnect.
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const wc = await EthereumProvider.init({
    projectId: WC_PROJECT_ID,
    chains: [CHAIN.id],
    showQrModal: true,
    rpcMap: { [CHAIN.id]: CHAIN.rpc },
    metadata: {
      name: "LightTable",
      description: "A community cookbook on LCAI.",
      url: "https://lighttable.vercel.app",
      icons: ["https://lighttable.vercel.app/icon.png"],
    },
  });
  await wc.connect(); // opens the QR / deep-link modal
  activeEip1193 = wc;
}

/** The currently-active EIP-1193 provider, or null if not connected. */
export function getActiveEip1193(): any {
  return activeEip1193;
}

/** Clear the active wallet (disconnect). */
export async function disconnectWallet(): Promise<void> {
  try {
    if (activeEip1193 && typeof activeEip1193.disconnect === "function") {
      await activeEip1193.disconnect();
    }
  } catch { /* ignore */ }
  activeEip1193 = null;
}

/** Browser provider over whichever wallet is active. Falls back to injected
 *  (preserves old behavior for any code path that connects before choosing). */
export function getProvider(): ethers.BrowserProvider {
  const eip = activeEip1193 || (hasInjected() ? window.ethereum : null);
  if (!eip) {
    throw new Error("No wallet connected. Tap Connect to choose a wallet.");
  }
  return new ethers.BrowserProvider(eip);
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
  const eip = activeEip1193 || (hasInjected() ? window.ethereum : null);
  if (!eip) throw new Error("No wallet connected.");
  try {
    await eip.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN.idHex }],
    });
  } catch (err: any) {
    // 4902 = chain not added to the wallet yet
    if (err.code === 4902) {
      await eip.request({
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
