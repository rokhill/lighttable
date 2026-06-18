import { Redis } from "@upstash/redis";
import type { RecipeContent } from "./recipes";

// ---------------------------------------------------------------------------
// Off-chain recipe text store (Upstash Redis, free tier).
// Keyed by contentHash so it aligns with the on-chain anchor: the chain holds
// the hash, we fetch the text by that exact hash, then verify.
//
// Requires env vars (set these after creating a free Upstash database):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// ---------------------------------------------------------------------------

let _redis: Redis | null = null;

export function redis(): Redis {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Upstash not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your environment."
    );
  }
  _redis = new Redis({ url, token });
  return _redis;
}

const keyFor = (hash: string) => `recipe:${hash.toLowerCase()}`;

export async function putRecipeText(hash: string, content: RecipeContent): Promise<void> {
  await redis().set(keyFor(hash), JSON.stringify(content));
}

export async function getRecipeText(hash: string): Promise<RecipeContent | null> {
  const raw = await redis().get<string>(keyFor(hash));
  if (!raw) return null;
  // Upstash may return an already-parsed object or a string depending on how it was stored.
  if (typeof raw === "object") return raw as unknown as RecipeContent;
  try {
    return JSON.parse(raw) as RecipeContent;
  } catch {
    return null;
  }
}

export async function getManyRecipeTexts(
  hashes: string[]
): Promise<Record<string, RecipeContent | null>> {
  if (hashes.length === 0) return {};
  const r = redis();
  const keys = hashes.map(keyFor);
  const values = await r.mget<(string | object | null)[]>(...keys);
  const out: Record<string, RecipeContent | null> = {};
  hashes.forEach((h, i) => {
    const v = values[i];
    if (v == null) {
      out[h.toLowerCase()] = null;
    } else if (typeof v === "object") {
      out[h.toLowerCase()] = v as unknown as RecipeContent;
    } else {
      try {
        out[h.toLowerCase()] = JSON.parse(v) as RecipeContent;
      } catch {
        out[h.toLowerCase()] = null;
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Profile names — address -> display name. Cosmetic only; the on-chain creator
// address is the real identity, names just skin it. One record per address so
// changing a name updates everywhere at once.
// ---------------------------------------------------------------------------

const PROFILES_KEY = "profiles"; // hash map: address(lower) -> name

export async function setProfileName(address: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 32);
  if (!clean) {
    await redis().hdel(PROFILES_KEY, address.toLowerCase());
    return;
  }
  await redis().hset(PROFILES_KEY, { [address.toLowerCase()]: clean });
}

export async function getAllProfiles(): Promise<Record<string, string>> {
  const all = await redis().hgetall<Record<string, string>>(PROFILES_KEY);
  return all || {};
}

// ---------------------------------------------------------------------------
// Hide-list — owner moderation. A set of recipe ids hidden from the UI. The
// recipe still exists on-chain (nothing is truly deleted); the frontend just
// stops showing it. Honest: "hidden by moderator", not "deleted".
// ---------------------------------------------------------------------------

const HIDDEN_KEY = "hidden"; // set of recipe id strings

export async function hideRecipe(id: number): Promise<void> {
  await redis().sadd(HIDDEN_KEY, String(id));
}

export async function unhideRecipe(id: number): Promise<void> {
  await redis().srem(HIDDEN_KEY, String(id));
}

export async function getHiddenIds(): Promise<number[]> {
  const members = await redis().smembers(HIDDEN_KEY);
  return (members || []).map((m) => Number(m)).filter((n) => !Number.isNaN(n));
}

// ---------------------------------------------------------------------------
// Owner overrides for ranks & badges. Stored off-chain (like the hide-list),
// owner-signature-gated. Lets the owner: bump someone's rank manually, grant a
// badge by hand, or revoke a badge (e.g. if someone gamed the system).
//
//   OVERRIDES_KEY (hash): address -> JSON { rankLevel?: number,
//                                           grant?: string[],   // badge ids forced on
//                                           revoke?: string[] } // badge ids forced off
// ---------------------------------------------------------------------------

const OVERRIDES_KEY = "rank_overrides";

export interface RankOverride {
  rankLevel?: number;   // force a specific rank level (owner-set)
  grant?: string[];     // badge ids to force-grant
  revoke?: string[];    // badge ids to force-remove
}

export async function getAllOverrides(): Promise<Record<string, RankOverride>> {
  const all = await redis().hgetall<Record<string, string>>(OVERRIDES_KEY);
  if (!all) return {};
  const out: Record<string, RankOverride> = {};
  for (const [addr, raw] of Object.entries(all)) {
    try { out[addr.toLowerCase()] = typeof raw === "string" ? JSON.parse(raw) : (raw as any); } catch {}
  }
  return out;
}

export async function setOverride(address: string, ov: RankOverride): Promise<void> {
  const addr = address.toLowerCase();
  // empty override => delete the entry
  const empty = (ov.rankLevel == null) && !(ov.grant && ov.grant.length) && !(ov.revoke && ov.revoke.length);
  if (empty) {
    await redis().hdel(OVERRIDES_KEY, addr);
    return;
  }
  await redis().hset(OVERRIDES_KEY, { [addr]: JSON.stringify(ov) });
}
