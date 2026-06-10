"use client";

import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  CHAIN,
  getProvider,
  getSigner,
  getReadProvider,
  getRecipeBookRead,
  getRecipeBookWrite,
  switchToLCAI,
  formatLCAI,
  parseLCAI,
  shortAddr,
  explorerTx,
} from "@/lib/contracts";
import {
  hashContent,
  verifyContent,
  type Recipe,
  type RecipeContent,
} from "@/lib/recipes";

type Tab = "browse" | "submit" | "ai";
type Toast = { msg: string; kind: "ok" | "err" | "info" } | null;

export default function Home() {
  const [tab, setTab] = useState<Tab>("browse");
  const [dark, setDark] = useState(false);
  const [wallet, setWallet] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>("0");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  // submit form
  const [fTitle, setFTitle] = useState("");
  const [fIng, setFIng] = useState("");
  const [fSteps, setFSteps] = useState("");
  const [fTag, setFTag] = useState("");

  // tip modal
  const [tipFor, setTipFor] = useState<Recipe | null>(null);
  const [tipAmt, setTipAmt] = useState("5");

  // which recipe is expanded (click to open)
  const [expanded, setExpanded] = useState<number | null>(null);

  // ai
  const [aiQ, setAiQ] = useState("");
  const [aiOut, setAiOut] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const showToast = (msg: string, kind: "ok" | "err" | "info" = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 4200);
  };

  // Ingredients: split on commas. Steps: split on line breaks (then on
  // sentence-ish boundaries if the cook typed one long line).
  const parseIngredients = (s: string): string[] =>
    (s || "")
      .split(/,|\n/)
      .map((x) => x.trim())
      .filter(Boolean);

  const parseSteps = (s: string): string[] => {
    const byLine = (s || "")
      .split(/\n+/)
      .map((x) => x.trim())
      .filter(Boolean);
    return byLine;
  };

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("lt-theme", next ? "dark" : "light");
    } catch {}
  };

  // ----- load recipes: on-chain facts + off-chain text + hash verify -----
  const loadRecipes = useCallback(async () => {
    setLoading(true);
    try {
      const c = getRecipeBookRead();
      const count: bigint = await c.recipeCount();
      const n = Number(count);
      if (n === 0) {
        setRecipes([]);
        setLoading(false);
        return;
      }
      const page = await c.getRecipes(0, n); // tuple[]
      const onChain = page.map((r: any, i: number) => ({
        id: i,
        creator: r.creator as string,
        contentHash: r.contentHash as string,
        upvotes: Number(r.upvotes),
        createdAt: Number(r.createdAt),
      }));

      // fetch off-chain text for all hashes in one batch
      const hashes = onChain.map((r: any) => r.contentHash).join(",");
      let texts: Record<string, RecipeContent | null> = {};
      try {
        const res = await fetch(`/api/recipes?hashes=${encodeURIComponent(hashes)}`);
        const data = await res.json();
        texts = data.contents || {};
      } catch {
        texts = {};
      }

      const merged: Recipe[] = onChain.map((r: any) => {
        const content = texts[r.contentHash?.toLowerCase()] || null;
        const verified = content ? verifyContent(content, r.contentHash) : false;
        return {
          ...r,
          title: content?.title || "(recipe text unavailable)",
          ingredients: content?.ingredients || "",
          steps: content?.steps || "",
          tag: content?.tag || "",
          imageUrl: content?.imageUrl || "",
          hashVerified: verified,
        };
      });
      // newest first by createdAt
      merged.sort((a, b) => b.createdAt - a.createdAt);
      setRecipes(merged);
    } catch (e: any) {
      showToast("Couldn't reach the LCAI network. Check your connection and refresh.", "err");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecipes();
  }, [loadRecipes]);

  // ----- wallet -----
  const connect = async () => {
    try {
      if (typeof window === "undefined" || !window.ethereum) {
        showToast("No wallet found. Install MetaMask to connect.", "err");
        return;
      }
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await switchToLCAI();
      const signer = await getSigner();
      const addr = await signer.getAddress();
      const bal = await getReadProvider().getBalance(addr);
      setWallet(addr);
      setBalance(formatLCAI(bal));
      showToast("Wallet connected.", "ok");
    } catch (e: any) {
      showToast(e?.message || "Couldn't connect wallet.", "err");
    }
  };

  const refreshBalance = async (addr: string) => {
    try {
      const bal = await getReadProvider().getBalance(addr);
      setBalance(formatLCAI(bal));
    } catch {}
  };

  // ----- submit -----
  const submit = async () => {
    if (!wallet) return showToast("Connect your wallet to publish.", "info");
    if (!fTitle.trim()) return showToast("Give your recipe a title first.", "info");
    setBusy(true);
    try {
      const content: RecipeContent = {
        title: fTitle,
        ingredients: fIng,
        steps: fSteps,
        tag: fTag,
      };
      // 1) store text off-chain; server returns the canonical hash
      const res = await fetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Couldn't save the recipe text.");
      }
      const { hash } = await res.json();
      // sanity: client-computed hash should match server's
      if (hash.toLowerCase() !== hashContent(content).toLowerCase()) {
        throw new Error("Hash mismatch — not submitting. Please retry.");
      }
      // 2) anchor the hash on-chain (postFee is 0, so no value needed)
      const c = await getRecipeBookWrite();
      const tx = await c.submitRecipe(hash);
      showToast("Publishing… confirm in your wallet, then waiting for the chain.", "info");
      await tx.wait(1);
      setFTitle(""); setFIng(""); setFSteps(""); setFTag("");
      setTab("browse");
      showToast("Recipe published. Hash anchored on-chain.", "ok");
      await loadRecipes();
    } catch (e: any) {
      showToast(e?.reason || e?.message || "Publish failed.", "err");
    } finally {
      setBusy(false);
    }
  };

  // ----- tip -----
  const doTip = async () => {
    if (!tipFor) return;
    if (!wallet) return showToast("Connect your wallet to tip.", "info");
    const amt = parseFloat(tipAmt);
    if (!(amt > 0)) return showToast("Enter a tip amount above zero.", "info");
    setBusy(true);
    try {
      const c = await getRecipeBookWrite();
      const tx = await c.tip(tipFor.id, { value: parseLCAI(tipAmt) });
      showToast("Tipping… confirm in your wallet.", "info");
      await tx.wait(1);
      setTipFor(null);
      showToast(`Tipped ${amt} LCAI — 95% to the cook, 5% platform, one signature.`, "ok");
      await loadRecipes();
      if (wallet) refreshBalance(wallet);
    } catch (e: any) {
      showToast(e?.reason || e?.message || "Tip failed.", "err");
    } finally {
      setBusy(false);
    }
  };

  // ----- upvote -----
  const upvote = async (r: Recipe) => {
    if (!wallet) return showToast("Connect your wallet to upvote.", "info");
    setBusy(true);
    try {
      const c = await getRecipeBookWrite();
      const tx = await c.upvote(r.id);
      await tx.wait(1);
      showToast("Upvoted — recorded on-chain.", "ok");
      await loadRecipes();
    } catch (e: any) {
      const msg = e?.reason || e?.message || "";
      if (msg.includes("AlreadyUpvoted")) showToast("You've already upvoted this one.", "info");
      else showToast(msg || "Upvote failed.", "err");
    } finally {
      setBusy(false);
    }
  };

  // ----- ai (placeholder until inference route is wired) -----
  const askKitchen = async () => {
    if (!aiQ.trim()) return showToast("Tell the kitchen what to change.", "info");
    setAiBusy(true);
    setAiOut(null);
    // The real flow runs an LCAI inference job (browser-keyed crypto + relayer).
    // Wired in the next build step. For now, an honest placeholder.
    setTimeout(() => {
      setAiOut(
        "The LCAI inference feature is coming in the next build step — it will run a real on-chain job and return a private, browser-decrypted suggestion."
      );
      setAiBusy(false);
    }, 600);
  };

  const C = "var(--text)";
  const C2 = "var(--text-2)";
  const C3 = "var(--text-3)";

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {/* header */}
        <header
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexWrap: "wrap", gap: 12, padding: "16px 22px",
            background: "var(--header-bg)", borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: "var(--grad)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <i className="ti ti-flame" style={{ fontSize: 19, color: "#fff" }} aria-hidden />
            </span>
            <span style={{ fontSize: 21, fontWeight: 500, color: C }}>LightTable</span>
            <span style={{ fontSize: 10, color: "var(--chip-text)", background: "var(--chip-bg)", padding: "3px 8px", borderRadius: 20, letterSpacing: 0.4 }}>ON LCAI</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: C3 }}>
              <i className="ti ti-circle-filled" style={{ fontSize: 8, color: "var(--ok)", verticalAlign: 1 }} aria-hidden /> mainnet · 9200
            </span>
            <button onClick={toggleTheme} aria-label="Toggle theme" style={{ background: "transparent", border: "1px solid var(--border-2)", color: C2, width: 34, height: 34, borderRadius: 9, cursor: "pointer" }}>
              <i className={dark ? "ti ti-sun" : "ti ti-moon"} style={{ fontSize: 16 }} aria-hidden />
            </button>
            <button
              onClick={connect}
              style={{ background: wallet ? "var(--bg-sunken)" : "var(--grad)", color: wallet ? C : "#fff", border: "none", padding: "8px 17px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: "pointer" }}
            >
              {wallet ? `${shortAddr(wallet)} · ${balance} LCAI` : "Connect wallet"}
            </button>
          </div>
        </header>

        {/* hero */}
        <section style={{ padding: "32px 22px 22px", textAlign: "center", background: "radial-gradient(ellipse at 50% -10%, var(--hero-glow) 0%, var(--bg) 60%)" }}>
          <h1 className="serif" style={{ fontSize: 31, lineHeight: 1.18, margin: "0 0 8px", color: C, letterSpacing: "-0.4px", fontWeight: 400 }}>
            Share your{" "}
            <span style={{ background: "var(--grad)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", fontStyle: "italic" }}>table</span>.
          </h1>
          <p style={{ fontSize: 14, color: C2, margin: "0 auto 22px", maxWidth: 450, lineHeight: 1.6 }}>
            A community cookbook where good recipes earn their keep. Post a dish, tip the cooks you love in LCAI, and let on-chain AI adapt anything to your kitchen.
          </p>
          <div style={{ display: "inline-flex", gap: 6, background: "var(--bg-sunken)", padding: 5, borderRadius: 11 }}>
            {(["browse", "submit", "ai"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  border: "none", padding: "7px 17px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer",
                  background: tab === t ? "var(--bg-raised)" : "transparent",
                  color: tab === t ? C : C3,
                }}
              >
                {t === "browse" ? "Browse" : t === "submit" ? "Add a recipe" : "Ask the kitchen"}
              </button>
            ))}
          </div>
        </section>

        <div style={{ padding: "6px 22px 40px" }}>
          {/* BROWSE */}
          {tab === "browse" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "10px 0 14px" }}>
                <span style={{ fontSize: 11, color: C3, textTransform: "uppercase", letterSpacing: 1 }}>Recipes</span>
                <span style={{ fontSize: 12, color: C3 }}>{recipes.length} on-chain · newest first</span>
              </div>

              {loading ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: C3, fontSize: 14 }}>
                  <i className="ti ti-loader-2" style={{ fontSize: 18 }} aria-hidden /> Loading recipes from LCAI…
                </div>
              ) : recipes.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 20px", border: "1px dashed var(--border-2)", borderRadius: 12 }}>
                  <p className="serif" style={{ fontSize: 18, color: C, margin: "0 0 6px" }}>No recipes yet.</p>
                  <p style={{ fontSize: 13, color: C2, margin: "0 0 16px" }}>Be the first to set the table.</p>
                  <button onClick={() => setTab("submit")} style={{ background: "var(--grad)", color: "#fff", border: "none", padding: "9px 18px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Add the first recipe</button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                  {recipes.map((r) => {
                    const isOpen = expanded === r.id;
                    const ings = parseIngredients(r.ingredients);
                    const steps = parseSteps(r.steps);
                    return (
                    <article key={r.id} style={{ background: "var(--bg-raised)", border: `1px solid ${isOpen ? "var(--border-hover)" : "var(--border)"}`, borderRadius: 12, overflow: "hidden" }}>
                      {/* collapsed header — click to toggle */}
                      <div
                        onClick={() => setExpanded(isOpen ? null : r.id)}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, padding: "14px 16px", cursor: "pointer" }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <i className={isOpen ? "ti ti-chevron-down" : "ti ti-chevron-right"} style={{ fontSize: 15, color: C3, flexShrink: 0 }} aria-hidden />
                            <p className="serif" style={{ fontSize: 17, margin: 0, color: C, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</p>
                            {r.hashVerified && (
                              <span title="Off-chain text matches the on-chain hash" style={{ color: "var(--ok)", fontSize: 13, flexShrink: 0 }}>
                                <i className="ti ti-rosette-discount-check" aria-hidden />
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, marginLeft: 23 }}>
                            <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--grad)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 500, color: "#fff", flexShrink: 0 }}>
                              {r.creator.slice(2, 4).toUpperCase()}
                            </span>
                            <span style={{ fontSize: 11, color: "var(--text-mono)", fontFamily: "monospace" }}>{shortAddr(r.creator)}</span>
                            {r.tag && <span style={{ fontSize: 11, color: "var(--brand-2)", fontWeight: 500 }}>· {parseIngredients(r.tag)[0]}</span>}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => upvote(r)} disabled={busy} style={{ background: "transparent", border: "1px solid var(--border-hover)", color: C2, padding: "5px 9px", borderRadius: 8, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                            <i className="ti ti-arrow-up" style={{ fontSize: 13, verticalAlign: -1 }} aria-hidden /> {r.upvotes}
                          </button>
                          <button onClick={() => { setTipFor(r); setTipAmt("5"); }} style={{ background: "var(--tip-btn)", border: "none", color: "var(--tip-btn-text)", padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>Tip</button>
                        </div>
                      </div>

                      {/* expanded — the actual cookable recipe */}
                      {isOpen && (
                        <div style={{ padding: "4px 18px 18px 39px", borderTop: "1px solid var(--border)" }}>
                          {r.tag && parseIngredients(r.tag).length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "14px 0" }}>
                              {parseIngredients(r.tag).map((t, i) => (
                                <span key={i} style={{ fontSize: 11, color: "var(--chip-text)", background: "var(--chip-bg)", padding: "3px 9px", borderRadius: 20 }}>{t}</span>
                              ))}
                            </div>
                          )}

                          {ings.length > 0 && (
                            <div style={{ marginBottom: 16 }}>
                              <p style={{ fontSize: 11, color: C3, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 8px" }}>Ingredients</p>
                              <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {ings.map((ing, i) => (
                                  <li key={i} style={{ fontSize: 14, color: C2, lineHeight: 1.7 }}>{ing}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {steps.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <p style={{ fontSize: 11, color: C3, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 8px" }}>Steps</p>
                              <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none", counterReset: "step" }}>
                                {steps.map((st, i) => (
                                  <li key={i} style={{ fontSize: 14, color: C2, lineHeight: 1.6, marginBottom: 10, display: "flex", gap: 10 }}>
                                    <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: "var(--bg-sunken)", color: C, fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                                    <span>{st}</span>
                                  </li>
                                ))}
                              </ol>
                            </div>
                          )}

                          {ings.length === 0 && steps.length === 0 && (
                            <p style={{ fontSize: 13, color: C3, margin: "14px 0 0" }}>This recipe has no details yet.</p>
                          )}
                        </div>
                      )}
                    </article>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* SUBMIT */}
          {tab === "submit" && (
            <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 13, padding: 19, marginTop: 8 }}>
              {(["Recipe title", "Ingredients", "Steps", "Tag (optional)"] as const).map((label, i) => {
                const isTitle = i === 0, isTag = i === 3;
                const val = [fTitle, fIng, fSteps, fTag][i];
                const set = [setFTitle, setFIng, setFSteps, setFTag][i];
                const ph = [
                  "Grandma's olive-oil banana bread",
                  "3 ripe bananas, 1/3 cup olive oil, 3/4 cup sugar (separate with commas)",
                  "Mash the bananas\nWhisk in oil and sugar\nFold in flour, bake 30 min (one step per line)",
                  "15 min, vegan, dessert (separate with commas)",
                ][i];
                return (
                  <div key={label} style={{ marginBottom: 15 }}>
                    <label style={{ display: "block", fontSize: 11, color: C2, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>{label}</label>
                    {isTitle || isTag ? (
                      <input value={val} onChange={(e) => set(e.target.value)} placeholder={ph}
                        style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-2)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: C }} />
                    ) : (
                      <textarea value={val} onChange={(e) => set(e.target.value)} placeholder={ph} rows={i === 2 ? 4 : 3}
                        style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-2)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: C, resize: "vertical" }} />
                    )}
                  </div>
                );
              })}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: C3 }}>
                  <i className="ti ti-lock" style={{ fontSize: 13, verticalAlign: -1 }} aria-hidden /> off-chain text · hash anchored on-chain · free to post
                </span>
                <button onClick={submit} disabled={busy} style={{ background: "var(--grad)", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}>
                  {busy ? "Publishing…" : "Publish recipe"}
                </button>
              </div>
            </div>
          )}

          {/* AI */}
          {tab === "ai" && (
            <div style={{ marginTop: 8 }}>
              <div style={{ background: "var(--ai-panel)", border: "1px solid var(--ai-border)", borderRadius: 13, padding: 19 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 13 }}>
                  <i className="ti ti-sparkles" style={{ fontSize: 19, color: "var(--brand-2)" }} aria-hidden />
                  <span style={{ fontSize: 14, fontWeight: 500, color: C }}>LCAI kitchen assistant</span>
                  <span style={{ fontSize: 10, color: "var(--chip-text)", background: "var(--chip-bg)", padding: "3px 8px", borderRadius: 20, letterSpacing: 0.3 }}>DECENTRALIZED INFERENCE</span>
                </div>
                <input value={aiQ} onChange={(e) => setAiQ(e.target.value)} placeholder="Make the banana bread vegan and halve it"
                  style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--ai-border)", borderRadius: 8, padding: "11px 13px", fontSize: 14, color: C, marginBottom: 13 }} />
                <button onClick={askKitchen} disabled={aiBusy} style={{ background: "var(--grad)", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
                  {aiBusy ? "Running inference…" : "Ask the kitchen ↗"}
                </button>
                {aiOut && (
                  <div style={{ marginTop: 15, fontSize: 13, lineHeight: 1.6, color: C2, borderLeft: "2px solid var(--ai-rule)", paddingLeft: 13 }}>{aiOut}</div>
                )}
              </div>
              <p style={{ fontSize: 11, color: C3, margin: "11px 2px 0", lineHeight: 1.55 }}>
                Each suggestion runs as a real inference job on LCAI workers (~0.02 LCAI from your wallet). Your prompt is encrypted in your browser — the relay never sees it.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* tip modal */}
      {tipFor && (
        <div onClick={() => setTipFor(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, maxWidth: 360, width: "100%" }}>
            <p className="serif" style={{ fontSize: 18, color: C, margin: "0 0 4px" }}>Tip this cook</p>
            <p style={{ fontSize: 13, color: C2, margin: "0 0 16px" }}>{tipFor.title}</p>
            <label style={{ display: "block", fontSize: 11, color: C2, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Amount (LCAI)</label>
            <input value={tipAmt} onChange={(e) => setTipAmt(e.target.value)} inputMode="decimal"
              style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-2)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: C, marginBottom: 8 }} />
            <p style={{ fontSize: 11, color: C3, margin: "0 0 16px" }}>95% goes to the cook, 5% to the platform — in one signature.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setTipFor(null)} style={{ background: "transparent", border: "1px solid var(--border-2)", color: C2, padding: "8px 16px", borderRadius: 9, fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={doTip} disabled={busy} style={{ background: "var(--tip-btn)", border: "none", color: "var(--tip-btn-text)", padding: "8px 18px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: busy ? "wait" : "pointer" }}>{busy ? "Tipping…" : "Send tip"}</button>
            </div>
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: toast.kind === "err" ? "#7a1f2b" : "var(--toast-bg)", color: "var(--toast-text)", padding: "11px 18px", borderRadius: 10, fontSize: 13, maxWidth: 440, zIndex: 60, boxShadow: "0 4px 20px rgba(0,0,0,0.25)" }}>
          {toast.msg}
        </div>
      )}
    </main>
  );
}
