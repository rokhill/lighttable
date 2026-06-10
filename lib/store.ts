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
