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
  // optional, cosmetic — does NOT affect identity/credit (that's the chain address)
  tag?: string;
  imageUrl?: string;
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
  const ordered = {
    title: (c.title ?? "").trim(),
    ingredients: (c.ingredients ?? "").trim(),
    steps: (c.steps ?? "").trim(),
    tag: (c.tag ?? "").trim(),
    imageUrl: (c.imageUrl ?? "").trim(),
  };
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
