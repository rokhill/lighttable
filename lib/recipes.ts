import { ethers } from "ethers";

// ---------------------------------------------------------------------------
// Recipe content lives OFF-chain. The contract stores only keccak256(canonical
// JSON) as `contentHash`, which anchors integrity: anyone can recompute the
// hash from the stored text and confirm it matches the chain.
//
// CRITICAL: the canonical serialization must be byte-identical on submit and on
// verify, or the hash won't match. We fix field order and use compact JSON.
// ---------------------------------------------------------------------------

export interface RecipeContent {
  title: string;
  ingredients: string;
  steps: string;
  // NEW: structured ingredients (amount + item). Optional so old recipes that
  // only have the `ingredients` string still validate and render.
  ingredientList?: { amount: string; item: string }[];
  // optional, cosmetic — does NOT affect identity/credit (that's the chain address)
  tag?: string;
  imageUrl?: string;
  servings?: number;
}

/** Full recipe = off-chain content + on-chain facts, joined by id. */
export interface Recipe extends RecipeContent {
  id: number;
  creator: string; // on-chain address — the real identity
  contentHash: string; // bytes32 hex, on-chain
  upvotes: number; // on-chain
  createdAt: number; // unix seconds, on-chain
  hashVerified: boolean; // did off-chain text match the on-chain hash?
}

/**
 * Canonical serialization — MUST be deterministic. Fixed key order, no
 * whitespace. Both submit and verify call this exact function so the keccak256
 * is identical.
 */
export function canonicalize(c: RecipeContent): string {
  const list = Array.isArray(c.ingredientList)
    ? c.ingredientList
        .map((x) => ({ amount: (x.amount ?? "").trim(), item: (x.item ?? "").trim() }))
        .filter((x) => x.amount || x.item)
    : [];
  const ordered: Record<string, unknown> = {
    title: (c.title ?? "").trim(),
    ingredients: (c.ingredients ?? "").trim(),
    steps: (c.steps ?? "").trim(),
    tag: (c.tag ?? "").trim(),
    imageUrl: (c.imageUrl ?? "").trim(),
  };
  // Only include the structured list when it has entries, so older recipes
  // (which never had this field) hash exactly as they did before — preserving
  // their on-chain hash verification. Key order is fixed for determinism.
  if (list.length > 0) {
    ordered.ingredientList = list;
  }
  return JSON.stringify(ordered);
}

/** keccak256 of the canonical JSON — this is the bytes32 written on-chain. */
export function hashContent(c: RecipeContent): string {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalize(c)));
}

/** Verify off-chain text against an on-chain hash. */
export function verifyContent(c: RecipeContent, onChainHash: string): boolean {
  return hashContent(c).toLowerCase() === onChainHash.toLowerCase();
}
