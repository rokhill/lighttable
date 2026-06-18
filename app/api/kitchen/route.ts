import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function svc() {
  const base = process.env.AI_SERVICE_URL;
  const secret = process.env.AI_SERVICE_SECRET;
  if (!base || !secret) return null;
  return { base: base.replace(/\/$/, ""), secret };
}

export async function POST(req: NextRequest) {
  const s = svc();
  if (!s) return NextResponse.json({ error: "The kitchen isn't connected yet." }, { status: 503 });

  const action = req.nextUrl.searchParams.get("action") || "start";
  if (action !== "start") return NextResponse.json({ error: "bad action" }, { status: 400 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request." }, { status: 400 }); }

  const kind = body?.kind === "adapt" ? "adapt" : "ask";
  const request = typeof body?.request === "string" ? body.request.trim() : "";
  const recipe = body?.recipe ?? null;
  const paymentTx = typeof body?.paymentTx === "string" ? body.paymentTx : null;
  const payer = typeof body?.payer === "string" ? body.payer : null;

  if (!request) return NextResponse.json({ error: "Tell the kitchen what you'd like." }, { status: 400 });
  if (request.length > 500) return NextResponse.json({ error: "Keep it under 500 characters." }, { status: 400 });

  try {
    const r = await fetch(`${s.base}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ai-secret": s.secret },
      body: JSON.stringify({ kind, recipe, request, paymentTx, payer }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ error: data?.error || "The kitchen is closed right now." }, { status: r.status });
    }
    return NextResponse.json({ jobId: data.jobId });
  } catch {
    return NextResponse.json({ error: "The kitchen is closed right now. Try again in a moment." }, { status: 503 });
  }
}

export async function GET(req: NextRequest) {
  const s = svc();
  if (!s) return NextResponse.json({ error: "The kitchen isn't connected yet." }, { status: 503 });

  const action = req.nextUrl.searchParams.get("action");
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (action !== "result" || !jobId) return NextResponse.json({ error: "bad request" }, { status: 400 });

  try {
    const r = await fetch(`${s.base}/result?jobId=${encodeURIComponent(jobId)}`, {
      headers: { "x-ai-secret": s.secret },
      signal: AbortSignal.timeout(20000),
    });
    const data = await r.json().catch(() => ({}));
    return NextResponse.json(data, { status: r.status === 404 ? 404 : 200 });
  } catch {
    return NextResponse.json({ status: "error", error: "Lost contact with the kitchen. Try again." }, { status: 503 });
  }
}
