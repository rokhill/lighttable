import { NextRequest, NextResponse } from "next/server";
import { getAllOverrides, setOverride, type RankOverride } from "@/lib/store";
import { rankOverrideMessage, recoverFresh, OWNER_ADDRESS } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET -> { overrides: { [address]: RankOverride } }
export async function GET() {
  try {
    const overrides = await getAllOverrides();
    return NextResponse.json({ overrides });
  } catch (e: any) {
    if (String(e?.message || e).includes("Upstash not configured")) {
      return NextResponse.json({ overrides: {} });
    }
    return NextResponse.json({ error: "Could not load overrides." }, { status: 500 });
  }
}

// POST { address, override, ts, signature } -> owner only.
export async function POST(req: NextRequest) {
  try {
    const { address, override, ts, signature } = await req.json();
    if (!address || !override || !ts || !signature) {
      return NextResponse.json({ error: "Missing fields." }, { status: 400 });
    }
    const msg = rankOverrideMessage(address, ts);
    const signer = recoverFresh(msg, signature, ts);
    if (!signer || signer !== OWNER_ADDRESS) {
      return NextResponse.json({ error: "Only the owner can set ranks/badges." }, { status: 401 });
    }
    const ov: RankOverride = {
      rankLevel: typeof override.rankLevel === "number" ? override.rankLevel : undefined,
      grant: Array.isArray(override.grant) ? override.grant.filter((x: any) => typeof x === "string") : undefined,
      revoke: Array.isArray(override.revoke) ? override.revoke.filter((x: any) => typeof x === "string") : undefined,
    };
    await setOverride(address, ov);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (String(e?.message || e).includes("Upstash not configured")) {
      return NextResponse.json({ error: "Storage isn't set up yet." }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not save override." }, { status: 500 });
  }
}
