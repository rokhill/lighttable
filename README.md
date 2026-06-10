# LightTable

A community cookbook on LCAI. Share recipes, tip the cooks you love in LCAI,
and (coming next) adapt any recipe with on-chain AI.

- Contract (RecipeBook): `0xD55bd722178c22cE776d2b4a09D984feaDA2e870` on LCAI mainnet (chain 9200)
- On-chain: creator, contentHash, upvotes, tips (95/5 split). Recipes immutable.
- Off-chain: recipe text in Upstash Redis, keyed by keccak hash, integrity-verified in the UI.

## Run locally
1. `npm install`
2. Create a free Upstash Redis DB → copy `.env.local.example` to `.env.local`, fill in the two values.
3. `npm run dev` → http://localhost:3000

## Deploy (Vercel)
`npx vercel --prod` — set the two UPSTASH_* env vars in the Vercel project settings.
