import { NextRequest, NextResponse } from "next/server";
import { getHiddenIds, hideRecipe, unhideRecipe } from "@/lib/store";
import { moderationMessage, recoverFresh, OWNER_ADDRESS } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET -> { hidden: number[] }
export async function GET() {
  try {
    const hidden = await getHiddenIds();
    return NextResponse.json({ hidden });
  } catch (e: any) {
    if (String(e?.message || e).includes("Upstash not configured")) {
      return NextResponse.json({ hidden: [] });
    }
    return NextResponse.json({ error: "Could not load moderation list." }, { status: 500 });
  }
}

// POST { action: "hide"|"unhide", id, ts, signature } -> owner only.
// The signature must recover to the OWNER address.
export async function POST(req: NextRequest) {
  try {
    const { action, id, ts, signature } = await req.json();
    if ((action !== "hide" && action !== "unhide") || typeof id !== "number" || !ts || !signature) {
      return NextResponse.json({ error: "Missing or invalid fields." }, { status: 400 });
    }
    const msg = moderationMessage(action, id, ts);
    const signer = recoverFresh(msg, signature, ts);
    if (!signer || signer !== OWNER_ADDRESS) {
      return NextResponse.json({ error: "Only the owner can moderate." }, { status: 401 });
    }
    if (action === "hide") await hideRecipe(id);
    else await unhideRecipe(id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (String(e?.message || e).includes("Upstash not configured")) {
      return NextResponse.json({ error: "Storage isn't set up yet." }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not update moderation list." }, { status: 500 });
  }
}
