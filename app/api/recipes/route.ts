import { NextRequest, NextResponse } from "next/server";
import { putRecipeText, getRecipeText, getManyRecipeTexts } from "@/lib/store";
import { hashContent, type RecipeContent } from "@/lib/recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { content: RecipeContent } -> stores it under its own keccak hash.
// Server recomputes the hash and uses THAT as the key, so stored text always
// matches its hash. Returns { hash } so the client uses the same value on-chain.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const content = body?.content as RecipeContent | undefined;
    if (!content || typeof content.title !== "string" || !content.title.trim()) {
      return NextResponse.json({ error: "A recipe needs at least a title." }, { status: 400 });
    }
    const hash = hashContent(content);
    await putRecipeText(hash, content);
    return NextResponse.json({ hash });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("Upstash not configured")) {
      return NextResponse.json(
        { error: "Recipe storage isn't set up yet. Add Upstash credentials to enable submissions." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Could not save the recipe. Try again." }, { status: 500 });
  }
}

// GET ?hash=0x..        -> single
// GET ?hashes=0x..,0x.. -> batch { [hash]: content|null }
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const single = searchParams.get("hash");
    const many = searchParams.get("hashes");

    if (single) {
      const content = await getRecipeText(single);
      return NextResponse.json({ content });
    }
    if (many) {
      const list = many.split(",").map((h) => h.trim()).filter(Boolean);
      const map = await getManyRecipeTexts(list);
      return NextResponse.json({ contents: map });
    }
    return NextResponse.json({ error: "Provide hash or hashes." }, { status: 400 });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("Upstash not configured")) {
      // Browsing still works for on-chain data; text just shows as unavailable.
      return NextResponse.json({ contents: {}, content: null });
    }
    return NextResponse.json({ error: "Could not load recipes." }, { status: 500 });
  }
}
