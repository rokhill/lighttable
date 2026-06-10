import { NextRequest, NextResponse } from "next/server";
import { getAllProfiles, setProfileName } from "@/lib/store";
import { profileMessage, recoverFresh } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET -> { profiles: { address: name } }
export async function GET() {
  try {
    const profiles = await getAllProfiles();
    return NextResponse.json({ profiles });
  } catch (e: any) {
    if (String(e?.message || e).includes("Upstash not configured")) {
      return NextResponse.json({ profiles: {} });
    }
    return NextResponse.json({ error: "Could not load profiles." }, { status: 500 });
  }
}

// POST { address, name, ts, signature } -> set your own display name.
// The signature must recover to `address`, so you can only rename yourself.
export async function POST(req: NextRequest) {
  try {
    const { address, name, ts, signature } = await req.json();
    if (!address || typeof name !== "string" || !ts || !signature) {
      return NextResponse.json({ error: "Missing fields." }, { status: 400 });
    }
    const msg = profileMessage(address, name.trim().slice(0, 32), ts);
    const signer = recoverFresh(msg, signature, ts);
    if (!signer || signer !== String(address).toLowerCase()) {
      return NextResponse.json({ error: "Signature did not match your wallet." }, { status: 401 });
    }
    await setProfileName(address, name);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (String(e?.message || e).includes("Upstash not configured")) {
      return NextResponse.json({ error: "Storage isn't set up yet." }, { status: 503 });
    }
    return NextResponse.json({ error: "Could not save name." }, { status: 500 });
  }
}
