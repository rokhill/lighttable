import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Uploads a base64 image to imgbb and returns the hosted URL. The imgbb API key
// lives in the IMGBB_API_KEY env var (server-side only — never exposed to the
// client). Recipe photos are stored as a URL alongside the recipe text.
export async function POST(req: NextRequest) {
  try {
    const key = process.env.IMGBB_API_KEY;
    if (!key) {
      return NextResponse.json({ error: "Image uploads aren't configured yet." }, { status: 503 });
    }
    const { image } = await req.json(); // base64 (no data: prefix)
    if (!image || typeof image !== "string") {
      return NextResponse.json({ error: "No image provided." }, { status: 400 });
    }

    const form = new URLSearchParams();
    form.set("image", image);

    const res = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    if (!res.ok || !data?.data?.url) {
      return NextResponse.json({ error: "Upload failed. Try a different image." }, { status: 502 });
    }
    return NextResponse.json({ url: data.data.url });
  } catch {
    return NextResponse.json({ error: "Could not upload image." }, { status: 500 });
  }
}
