import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Inference can take a while (on-chain LCAI job). Allow a long server timeout.
export const maxDuration = 300;

// Proxies "Ask the Kitchen" requests to the LightTable AI service.
//
// The AI service URL + secret live ONLY here (server side), never in the
// browser. The frontend POSTs { kind, recipe?, request } and we add the secret
// and forward it to the AI service over the Cloudflare tunnel.
//
// Env:
//   AI_SERVICE_URL    e.g. https://xxxx.trycloudflare.com  (no trailing slash)
//   AI_SERVICE_SECRET must match the AI service's .env value
export async function POST(req: NextRequest) {
  const base = process.env.AI_SERVICE_URL;
  const secret = process.env.AI_SERVICE_SECRET;

  if (!base || !secret) {
    return NextResponse.json(
      { error: "The kitchen isn't connected yet. (AI service not configured.)" },
      { status: 503 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const kind = body?.kind === "adapt" ? "adapt" : "ask";
  const request = typeof body?.request === "string" ? body.request.trim() : "";
  const recipe = body?.recipe ?? null;

  if (!request) {
    return NextResponse.json({ error: "Tell the kitchen what you'd like." }, { status: 400 });
  }
  if (request.length > 500) {
    return NextResponse.json({ error: "That request is a bit long — keep it under 500 characters." }, { status: 400 });
  }

  const endpoint = `${base.replace(/\/$/, "")}/${kind}`;

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ai-secret": secret,
      },
      body: JSON.stringify({ recipe, request }),
      // Give the on-chain inference time to finish.
      signal: AbortSignal.timeout(280000),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Pass through the AI service's friendly "kitchen is closed" message.
      return NextResponse.json(
        { error: data?.error || "The kitchen is closed right now. Try again in a moment." },
        { status: r.status }
      );
    }
    return NextResponse.json({ result: data.result, engine: data.engine });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const closed =
      msg.includes("timeout") || msg.includes("aborted")
        ? "The kitchen took too long this time — please try again."
        : "The kitchen is closed right now. Try again in a moment.";
    return NextResponse.json({ error: closed }, { status: 503 });
  }
}
