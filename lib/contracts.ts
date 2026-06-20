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

// Treasury that receives the Ask-the-Kitchen fee, and the fee amount.
// Must match TREASURY_ADDRESS + MIN_PAYMENT_LCAI in the AI service .env.
export const AI_TREASURY = "0xDB902DC48ef55d5D69F6cB72583518577C6C021c";
export const AI_FEE_LCAI = "0.1";

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
async function initWalletConnect(): Promise<any> {
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://lighttable.vercel.app";
  return EthereumProvider.init({
    projectId: WC_PROJECT_ID,
    optionalChains: [CHAIN.id],
    showQrModal: true,
    rpcMap: { [CHAIN.id]: CHAIN.rpc },
    metadata: {
      name: "LightTable",
      description: "A community cookbook on LCAI.",
      url: origin,
      icons: [`${origin}/icon.png`],
      redirect: { native: "", universal: origin },
    },
  });
}

export async function connectWalletConnect(): Promise<void> {
  const wc = await initWalletConnect();
  await wc.connect(); // opens the QR / deep-link modal
  activeEip1193 = wc;
}

// Restore a previously-approved WalletConnect session on page load, WITHOUT
// popping the QR modal. WalletConnect persists the session in localStorage, so
// if the user connected before and didn't disconnect, this re-attaches to it —
// no need to scan/approve again every visit. Returns the connected address, or
// null if there's no live session to restore.
export async function restoreWalletConnect(): Promise<string | null> {
  try {
    if (typeof window === "undefined") return null;
    let hasStored = false;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || "";
      if (k.startsWith("wc@2") || k.includes("walletconnect")) { hasStored = true; break; }
    }
    if (!hasStored) return null;

    // EthereumProvider.init() rehydrates the stored session. After a mobile
    // deep-link bounce (which reloads the page and wipes the in-memory provider),
    // this is what re-attaches it. We adopt it as active and read the account —
    // without brittle assumptions about which internal flags are set.
    const wc: any = await initWalletConnect();
    let acct: string | undefined = (wc.accounts && wc.accounts[0]) || undefined;
    if (!acct) {
      try {
        const accts = await wc.request({ method: "eth_accounts" });
        if (Array.isArray(accts) && accts.length) acct = accts[0];
      } catch { /* no live session */ }
    }
    if (!acct) return null;
    activeEip1193 = wc;   // re-adopt so transactions have a provider after reload
    return acct;
  } catch { /* restore failed — user will connect manually */ }
  return null;
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

// Thrown when the WalletConnect session has died — the UI catches this to
// prompt a clean reconnect instead of showing a raw "call connect()" error.
export class StaleSessionError extends Error {
  constructor() { super("WALLET_SESSION_STALE"); this.name = "StaleSessionError"; }
}

export async function getSigner(): Promise<ethers.JsonRpcSigner> {
  // Just build the signer. We do NOT pre-validate the WalletConnect session
  // here — provider internals vary and guessing wrong wrongly rejects perfectly
  // live sessions (which broke tips/AI on mobile). If the session really is
  // dead, the actual call throws the "call connect()" error, which the UI maps
  // to a friendly reconnect prompt. Don't break the working path.
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
// Make sure the wallet is on LCAI before any write. Skips if already on LCAI;
// never blocks forever (mobile WalletConnect can hang the switch), and the
// callers pin chainId on the tx as a backstop.
export async function ensureLCAI(): Promise<void> {
  try {
    const signer = await getSigner();
    // The chain-check itself can hang over WalletConnect, so cap it.
    const net = await Promise.race([
      signer.provider.getNetwork(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    if (net && Number((net as any).chainId) === CHAIN.id) return; // already on LCAI
  } catch { /* can't read — attempt switch */ }
  try {
    await Promise.race([
      switchToLCAI(),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
  } catch { /* rejected/errored — proceed; chainId pin guards the tx */ }
}

// Wait for a tx receipt via the READ rpc (fast/direct) instead of the wallet
// provider — ethers' tx.wait() over WalletConnect frequently hangs. Returns
// the receipt, or null after the timeout (tx may still confirm; we just stop
// blocking the UI on it).
export async function waitForTx(txHash: string, timeoutMs = 60000): Promise<any> {
  const rp = getReadProvider();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const rec = await rp.getTransactionReceipt(txHash);
      if (rec) return rec;
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return null;
}

export async function getRecipeBookWrite(): Promise<ethers.Contract> {
  await ensureLCAI();
  const signer = await getSigner();
  return new ethers.Contract(CONTRACTS.recipeBook, RECIPE_BOOK_ABI, signer);
}

// ---------------------------------------------------------------------------
// Chain switching — the wallet_switch / wallet_add pattern from LightMarket
// ---------------------------------------------------------------------------

export async function switchToLCAI(): Promise<void> {
  const eip = activeEip1193 || (hasInjected() ? window.ethereum : null);
  if (!eip) throw new Error("No wallet connected.");

  const addParams = {
    chainId: CHAIN.idHex,
    chainName: CHAIN.name,
    nativeCurrency: { name: CHAIN.symbol, symbol: CHAIN.symbol, decimals: CHAIN.decimals },
    rpcUrls: [CHAIN.rpc],
    blockExplorerUrls: [CHAIN.explorer],
  };

  // First: are we already on LCAI? If so, nothing to do. (Trust Wallet/WC can
  // throw on switch even when already correct, so short-circuit here.)
  try {
    const current = await eip.request({ method: "eth_chainId" });
    if (typeof current === "string" && current.toLowerCase() === CHAIN.idHex.toLowerCase()) {
      return;
    }
  } catch { /* some providers don't answer eth_chainId pre-switch; continue */ }

  // Try a plain switch first (works when the chain is already known to the wallet).
  try {
    await eip.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN.idHex }],
    });
    return;
  } catch (switchErr: any) {
    // The old code only added on code 4902. But MetaMask uses 4902, while
    // Trust Wallet / WalletConnect / Coinbase often return a DIFFERENT code
    // (or none) when the chain is unknown — so the add never fired and users
    // saw "network not supported". Now we treat ANY switch failure as a reason
    // to attempt adding the chain, then switch again.
    const code = switchErr?.code;
    // 4001 = user explicitly rejected — respect that, don't loop.
    if (code === 4001) throw switchErr;

    try {
      await eip.request({
        method: "wallet_addEthereumChain",
        params: [addParams],
      });
    } catch (addErr: any) {
      if (addErr?.code === 4001) throw addErr; // user declined the add
      // Some wallets ADD successfully but still throw a vague/"unknown" error
      // on the response. Don't bail yet — fall through and try the switch; if
      // the chain actually got added, the switch below succeeds.
    }

    // After adding, switch to it. Some wallets auto-switch on add (this no-ops),
    // others need this explicit follow-up.
    try {
      await eip.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN.idHex }],
      });
    } catch (finalErr: any) {
      if (finalErr?.code === 4001) throw finalErr;
      // Last resort: verify by reading the chain. If we're on LCAI now, the
      // vague errors were noise and we're fine. If not, surface a clear message.
      try {
        const now = await eip.request({ method: "eth_chainId" });
        if (typeof now === "string" && now.toLowerCase() === CHAIN.idHex.toLowerCase()) {
          return;
        }
      } catch { /* fall through */ }
      throw new Error(
        "Couldn't switch to the Lightchain network automatically. Open your wallet, switch to “Lightchain AI” (chain 9200), then reconnect."
      );
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

// ---------------------------------------------------------------------------
// Transaction overrides — the WalletConnect double-prompt fix.
//
// ethers v6 BrowserProvider, before sending a tx, asks the wallet to do
// eth_estimateGas and fee lookups. Over WalletConnect each of those round-trips
// surfaces the wallet app, so the user sees "sign… now open your wallet AGAIN
// to complete." By pre-computing gas + fees here against the READ rpc (not the
// wallet) and passing them in, ethers skips its own estimation and the wallet
// gets exactly ONE request: the send. One prompt, no second hand-off.
//
// `from` is required for an accurate estimate; `value` covers tips.
// ---------------------------------------------------------------------------
export async function buildTxOverrides(
  data: { to: string; from: string; data?: string; value?: bigint }
): Promise<{ gasLimit: bigint; gasPrice: bigint; chainId: number }> {
  const rp = getReadProvider();
  let gasLimit: bigint;
  try {
    const est = await rp.estimateGas({
      to: data.to,
      from: data.from,
      data: data.data,
      value: data.value ?? 0n,
    });
    // 25% headroom so a slightly-off estimate doesn't revert.
    gasLimit = (est * 125n) / 100n;
  } catch {
    // Fallback if estimate fails — generous fixed limit for these simple calls.
    gasLimit = 300000n;
  }
  let gasPrice: bigint;
  try {
    const fee = await rp.getFeeData();
    gasPrice = fee.gasPrice ?? ethers.parseUnits("1", "gwei");
  } catch {
    gasPrice = ethers.parseUnits("1", "gwei");
  }
  // Pin to LCAI so a mobile wallet on the wrong network can't send on ETH.
  return { gasLimit, gasPrice, chainId: CHAIN.id };
}

// Pay the Ask-the-Kitchen fee: a plain LCAI transfer to the treasury.
// Returns the confirmed tx hash + payer address, which the AI service verifies
// on-chain before running inference. One signature, pre-computed gas so the
// wallet only prompts once (same trick as the contract writes).
export async function payForAI(): Promise<{ txHash: string; payer: string }> {
  await ensureLCAI();
  const signer = await getSigner();
  const payer = await signer.getAddress();

  const value = ethers.parseEther(AI_FEE_LCAI);
  const rp = getReadProvider();
  let gasPrice: bigint;
  try {
    const fee = await rp.getFeeData();
    gasPrice = fee.gasPrice ?? ethers.parseUnits("1", "gwei");
  } catch {
    gasPrice = ethers.parseUnits("1", "gwei");
  }
  const tx = await signer.sendTransaction({
    to: AI_TREASURY,
    value,
    gasLimit: 30000n,
    gasPrice,
    chainId: CHAIN.id, // pin to LCAI so the wallet can't send this on Ethereum
  });
  await waitForTx(tx.hash);
  return { txHash: tx.hash, payer };
}
