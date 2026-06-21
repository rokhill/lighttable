import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { getFeatured, setFeatured } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPC = "https://rpc.mainnet.lightchain.ai";
const CHAIN_ID = 9200;
const TREASURY = "0xDB902DC48ef55d5D69F6cB72583518577C6C021c".toLowerCase();
const FEATURED_FEE = "5";       // LCAI — must match FEATURED_FEE_LCAI on the client
const FEATURED_DAYS = 7;

// GET -> { featured: { recipeId, until, payer, txHash } | null }
export async function GET() {
  try {
    const featured = await getFeatured();
    return NextResponse.json({ featured });
  } catch (e: any) {
    if (String(e?.message || e).includes("Upstash not configured")) {
      return NextResponse.json({ featured: null });
    }
    return NextResponse.json({ error: "Could not load featured." }, { status: 500 });
  }
}

// POST { recipeId, txHash } -> verifies the on-chain payment, then features it.
// Verification: tx is confirmed, sent TO the treasury, for >= the fee, and the
// same txHash hasn't already been used to feature (replay guard via stored hash).
export async function POST(req: NextRequest) {
  try {
    const { recipeId, txHash } = await req.json();
    if (typeof recipeId !== "number" || !txHash || typeof txHash !== "string") {
      return NextResponse.json({ error: "Missing recipeId or txHash." }, { status: 400 });
    }

    // Replay guard: don't let one payment feature twice.
    const current = await getFeatured();
    if (current && current.txHash.toLowerCase() === txHash.toLowerCase()) {
      return NextResponse.json({ error: "That payment was already used." }, { status: 409 });
    }

    const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID);
    const tx = await provider.getTransaction(txHash);
    if (!tx) return NextResponse.json({ error: "Payment transaction not found." }, { status: 400 });
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      return NextResponse.json({ error: "Payment not confirmed yet." }, { status: 400 });
    }
    if ((tx.to || "").toLowerCase() !== TREASURY) {
      return NextResponse.json({ error: "Payment was not sent to the treasury." }, { status: 400 });
    }
    if (tx.value < ethers.parseEther(FEATURED_FEE)) {
      return NextResponse.json({ error: `Payment must be at least ${FEATURED_FEE} LCAI.` }, { status: 400 });
    }

    const payer = (tx.from || "").toLowerCase();
    const until = Date.now() + FEATURED_DAYS * 24 * 60 * 60 * 1000;
    await setFeatured({ recipeId, until, payer, txHash });
    return NextResponse.json({ ok: true, until });
  } catch (e: any) {
    if (String(e?.message || e).includes("Upstash not configured")) {
      return NextResponse.json({ error: "Storage isn't set up yet." }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not feature recipe." }, { status: 500 });
  }
}
