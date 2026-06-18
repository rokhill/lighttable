"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ethers } from "ethers";
import {
  CHAIN,
  CONTRACTS,
  getSigner,
  getReadProvider,
  getRecipeBookRead,
  getRecipeBookWrite,
  switchToLCAI,
  formatLCAI,
  parseLCAI,
  shortAddr,
  hasInjected,
  connectInjected,
  restoreWalletConnect,
  connectWalletConnect,
  disconnectWallet,
  buildTxOverrides,
  waitForTx,
  payForAI,
  AI_FEE_LCAI,
} from "@/lib/contracts";
import { hashContent, verifyContent, type Recipe, type RecipeContent } from "@/lib/recipes";
import { profileMessage, moderationMessage, nameFor, rankOverrideMessage } from "@/lib/profileNames";
import { rankFor, badgesFor, nextRank, type CookStats, type Override } from "@/lib/ranks";

const OWNER = "0xDB902DC48ef55d5D69F6cB72583518577C6C021c".toLowerCase();

type Tab = "browse" | "leaderboard" | "kitchen" | "submit" | "ai";
type Toast = { msg: string; kind: "ok" | "err" | "info" } | null;

// recipe + on-chain tip totals we compute from events
interface RecipeX extends Recipe { tipsTotal: number; ingredientList?: { amount: string; item: string }[]; }

const CATEGORIES = ["All", "Breakfast", "Lunch", "Dinner", "Dessert", "Vegan", "Vegetarian", "Drinks", "Snacks"];

export default function Home() {
  const [tab, setTab] = useState<Tab>("browse");
  const [dark, setDark] = useState(false);
  const [wallet, setWallet] = useState<string | null>(null);
  const [balance, setBalance] = useState("0");
  const [recipes, setRecipes] = useState<RecipeX[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<number[]>([]);
  const [overrides, setOverrides] = useState<Record<string, any>>({});
  const [tipsGiven, setTipsGiven] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  // filters
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("All");
  const [sortBy, setSortBy] = useState<"newest" | "top" | "upvoted">("newest");
  const [lbMode, setLbMode] = useState<"cooks" | "recipes">("cooks");

  // submit form
  const [fTitle, setFTitle] = useState("");
  const [fIngRows, setFIngRows] = useState<{ amount: string; item: string }[]>([{ amount: "", item: "" }]);
  const [fSteps, setFSteps] = useState("");
  const [fCat, setFCat] = useState("Dinner");
  const [fTag, setFTag] = useState("");

  // modals
  const [tipFor, setTipFor] = useState<RecipeX | null>(null);
  const [tipAmt, setTipAmt] = useState("5");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [nameModal, setNameModal] = useState(false);
  const [ownerPanel, setOwnerPanel] = useState<string | null>(null); // address being edited
  const [badgeInfo, setBadgeInfo] = useState<{ emoji: string; name: string; desc: string } | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [walletModal, setWalletModal] = useState(false);

  // ai
  const [aiQ, setAiQ] = useState("");
  const [aiOut, setAiOut] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiEngine, setAiEngine] = useState<string | null>(null);
  const [aiRecipe, setAiRecipe] = useState<{ title: string; ingredients: string; steps: string } | null>(null);
  const [aiStage, setAiStage] = useState<"pay" | "starting" | "cook" | null>(null);

  const isOwner = wallet?.toLowerCase() === OWNER;

  const showToast = (msg: string, kind: "ok" | "err" | "info" = "ok") => {
    setToast({ msg, kind }); setTimeout(() => setToast(null), 4200);
  };

  const parseList = (s: string): string[] => (s || "").split(/,|\n/).map((x) => x.trim()).filter(Boolean);
  const parseSteps = (s: string): string[] => (s || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);

  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);

  const toggleTheme = () => {
    const next = !dark; setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("lt-theme", next ? "dark" : "light"); } catch {}
  };

  // ---- load everything: chain recipes + tips + profiles + hidden ----
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const c = getRecipeBookRead();
      const count = Number(await c.recipeCount());

      // side data in parallel
      const [profRes, modRes, ovRes] = await Promise.all([
        fetch("/api/profiles").then((r) => r.json()).catch(() => ({ profiles: {} })),
        fetch("/api/moderation").then((r) => r.json()).catch(() => ({ hidden: [] })),
        fetch("/api/ranks").then((r) => r.json()).catch(() => ({ overrides: {} })),
      ]);
      setProfiles(profRes.profiles || {});
      setHidden(modRes.hidden || []);
      setOverrides(ovRes.overrides || {});

      if (count === 0) { setRecipes([]); setLoading(false); return; }

      const page = await c.getRecipes(0, count);
      const onChain = page.map((r: any, i: number) => ({
        id: i, creator: r.creator as string, contentHash: r.contentHash as string,
        upvotes: Number(r.upvotes), createdAt: Number(r.createdAt),
      }));

      // tip totals from Tipped events
      let tipMap: Record<number, number> = {};
      let tipsGivenMap: Record<string, number> = {};
      try {
        const ev = await c.queryFilter(c.filters.Tipped(), 0, "latest");
        for (const e of ev as any[]) {
          const id = Number(e.args?.id);
          const amt = parseFloat(ethers.formatUnits(e.args?.amount ?? 0n, CHAIN.decimals));
          tipMap[id] = (tipMap[id] || 0) + amt;
          const from = (e.args?.from as string | undefined)?.toLowerCase();
          if (from) tipsGivenMap[from] = (tipsGivenMap[from] || 0) + 1;
        }
      } catch { tipMap = {}; }
      setTipsGiven(tipsGivenMap);

      const hashes = onChain.map((r: any) => r.contentHash).join(",");
      let texts: Record<string, RecipeContent | null> = {};
      try {
        const res = await fetch(`/api/recipes?hashes=${encodeURIComponent(hashes)}`);
        texts = (await res.json()).contents || {};
      } catch { texts = {}; }

      const merged: RecipeX[] = onChain.map((r: any) => {
        const content = texts[r.contentHash?.toLowerCase()] || null;
        return {
          ...r,
          title: content?.title || "(recipe text unavailable)",
          ingredients: content?.ingredients || "",
          steps: content?.steps || "",
          ingredientList: content?.ingredientList || undefined,
          tag: content?.tag || "",
          imageUrl: content?.imageUrl || "",
          hashVerified: content ? verifyContent(content, r.contentHash) : false,
          tipsTotal: tipMap[r.id] || 0,
        };
      });
      merged.sort((a, b) => b.createdAt - a.createdAt);
      setRecipes(merged);
    } catch {
      showToast("Couldn't reach the LCAI network. Refresh to retry.", "err");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Silently restore a prior WalletConnect session on load — so a returning
  // mobile user doesn't have to scan/approve every single visit.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (hasInjected()) return; // injected wallets reconnect on their own
        const addr = await restoreWalletConnect();
        if (!addr || cancelled) return;
        const bal = await getReadProvider().getBalance(addr);
        if (cancelled) return;
        setWallet(addr); setBalance(formatLCAI(bal));
      } catch { /* no session to restore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- wallet ----
  // Open the chooser. On desktop with an injected wallet we *could* auto-connect,
  // but showing the choice is what fixes mobile + multi-wallet, so we always ask.
  const connect = () => setWalletModal(true);

  // Finish a connection once the user has picked a method.
  const finishConnect = async (method: "injected" | "walletconnect") => {
    setWalletModal(false);
    setBusy(true);
    try {
      if (method === "injected") {
        await connectInjected();
      } else {
        await connectWalletConnect();
      }
      await switchToLCAI();
      const signer = await getSigner();
      const addr = await signer.getAddress();
      const bal = await getReadProvider().getBalance(addr);
      setWallet(addr); setBalance(formatLCAI(bal));
      showToast("Wallet connected.", "ok");
    } catch (e: any) {
      const m = e?.message || "Couldn't connect.";
      // User closing the WalletConnect QR modal throws — treat as a quiet cancel.
      if (/User (rejected|closed)|Connection request reset|Modal closed/i.test(m)) {
        showToast("Connection cancelled.", "info");
      } else {
        showToast(m, "err");
      }
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    await disconnectWallet();
    setWallet(null); setBalance("0");
    showToast("Wallet disconnected.", "info");
  };

  // ---- submit ----
  const submit = async () => {
    if (!wallet) return showToast("Connect your wallet to publish.", "info");
    if (!fTitle.trim()) return showToast("Give your recipe a title first.", "info");
    const rows = fIngRows.map((r) => ({ amount: r.amount.trim(), item: r.item.trim() })).filter((r) => r.item);
    if (rows.length === 0) return showToast("Add at least one ingredient.", "info");
    if (!fSteps.trim()) return showToast("Add at least one step.", "info");
    setBusy(true);
    try {
      // Harden: get the signer FIRST. If the wallet is locked/disconnected,
      // this throws before we write anything to storage — no orphan text, no
      // half-finished submit.
      const c = await getRecipeBookWrite();

      const tag = [fCat, fTag].filter(Boolean).join(", ");
      // Keep a flat `ingredients` string too, for the old display fallback.
      const ingredients = rows.map((r) => [r.amount, r.item].filter(Boolean).join(" ")).join(", ");
      const content: RecipeContent = { title: fTitle, ingredients, steps: fSteps, ingredientList: rows, tag };

      const res = await fetch("/api/recipes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't save text.");
      const { hash } = await res.json();
      if (hash.toLowerCase() !== hashContent(content).toLowerCase()) throw new Error("Hash mismatch — retry.");
      // Tell the user to expect the wallet BEFORE it pops, so the prompt isn't a surprise.
      showToast("Confirm the transaction in your wallet…", "info");
      const ov = await buildTxOverrides({
        to: CONTRACTS.recipeBook,
        from: wallet,
        data: c.interface.encodeFunctionData("submitRecipe", [hash]),
      });
      const tx = await c.submitRecipe(hash, ov);
      showToast("Publishing to LCAI — this takes a few seconds…", "info");
      await waitForTx(tx.hash);
      setFTitle(""); setFIngRows([{ amount: "", item: "" }]); setFSteps(""); setFTag(""); setFCat("Dinner");
      setTab("browse"); showToast("Recipe published. Hash anchored on-chain.", "ok");
      await loadAll();
    } catch (e: any) { showToast(e?.reason || e?.message || "Publish failed.", "err"); }
    finally { setBusy(false); }
  };

  // ---- tip ----
  const doTip = async () => {
    if (!tipFor) return;
    if (!wallet) return showToast("Connect your wallet to tip.", "info");
    const amt = parseFloat(tipAmt);
    if (!(amt > 0)) return showToast("Enter an amount above zero.", "info");
    setBusy(true);
    try {
      const c = await getRecipeBookWrite();
      showToast("Confirm the tip in your wallet…", "info");
      const val = parseLCAI(tipAmt);
      const ov = await buildTxOverrides({
        to: CONTRACTS.recipeBook,
        from: wallet,
        data: c.interface.encodeFunctionData("tip", [tipFor.id]),
        value: val,
      });
      const tx = await c.tip(tipFor.id, { value: val, ...ov });
      showToast("Sending tip — a few seconds…", "info");
      await waitForTx(tx.hash);
      setTipFor(null);
      showToast(`Tipped ${amt} LCAI — 95% to the cook, 5% platform.`, "ok");
      await loadAll();
    } catch (e: any) { showToast(e?.reason || e?.message || "Tip failed.", "err"); }
    finally { setBusy(false); }
  };

  // ---- upvote ----
  const upvote = async (r: RecipeX) => {
    if (!wallet) return showToast("Connect your wallet to upvote.", "info");
    setBusy(true);
    try {
      const c = await getRecipeBookWrite();
      const ov = await buildTxOverrides({
        to: CONTRACTS.recipeBook,
        from: wallet!,
        data: c.interface.encodeFunctionData("upvote", [r.id]),
      });
      const tx = await c.upvote(r.id, ov); await waitForTx(tx.hash);
      showToast("Upvoted — recorded on-chain.", "ok"); await loadAll();
    } catch (e: any) {
      const m = e?.reason || e?.message || "";
      showToast(m.includes("AlreadyUpvoted") ? "You've already upvoted this." : (m || "Upvote failed."), m.includes("AlreadyUpvoted") ? "info" : "err");
    } finally { setBusy(false); }
  };

  // ---- set profile name (signed) ----
  const saveName = async () => {
    if (!wallet) return;
    setBusy(true);
    try {
      const ts = Date.now();
      const signer = await getSigner();
      const sig = await signer.signMessage(profileMessage(wallet, nameInput.trim().slice(0, 32), ts));
      const res = await fetch("/api/profiles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: wallet, name: nameInput, ts, signature: sig }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't save name.");
      setNameModal(false);
      showToast("Display name saved.", "ok");
      await loadAll();
    } catch (e: any) { showToast(e?.message || "Couldn't save name.", "err"); }
    finally { setBusy(false); }
  };

  // ---- owner hide / unhide (signed) ----
  const toggleHide = async (r: RecipeX) => {
    if (!isOwner) return;
    const action = hidden.includes(r.id) ? "unhide" : "hide";
    setBusy(true);
    try {
      const ts = Date.now();
      const signer = await getSigner();
      const sig = await signer.signMessage(moderationMessage(action, r.id, ts));
      const res = await fetch("/api/moderation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id: r.id, ts, signature: sig }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Moderation failed.");
      showToast(action === "hide" ? "Recipe hidden." : "Recipe restored.", "ok");
      await loadAll();
    } catch (e: any) { showToast(e?.message || "Moderation failed.", "err"); }
    finally { setBusy(false); }
  };

  const saveOverride = async (address: string, ov: Override) => {
    if (!isOwner) return;
    setBusy(true);
    try {
      const ts = Date.now();
      const signer = await getSigner();
      const sig = await signer.signMessage(rankOverrideMessage(address, ts));
      const res = await fetch("/api/ranks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, override: ov, ts, signature: sig }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Override failed.");
      showToast("Rank/badge updated.", "ok");
      await loadAll();
      setOwnerPanel(null);
    } catch (e: any) { showToast(e?.message || "Override failed.", "err"); }
    finally { setBusy(false); }
  };

  const askKitchen = async () => {
    if (!aiQ.trim()) return showToast("Tell the kitchen what you'd like.", "info");
    if (!wallet) return showToast("Connect your wallet to use the kitchen.", "info");
    setAiBusy(true); setAiOut(null); setAiEngine(null); setAiStage("pay");
    try {
      // 1) Pay the LCAI fee to the treasury (one signature).
      const { txHash, payer } = await payForAI();

      // 2) Start the job (fast — returns a jobId immediately).
      setAiStage("starting");
      const startRes = await fetch("/api/kitchen?action=start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: aiRecipe ? "adapt" : "ask",
          recipe: aiRecipe || null,
          request: aiQ.trim(),
          paymentTx: txHash,
          payer,
        }),
      });
      const startData = await startRes.json();
      if (!startRes.ok || !startData.jobId) throw new Error(startData?.error || "The kitchen is closed right now.");

      // 3) Poll for the result (each poll is quick — sidesteps the 60s limit).
      const jobId = startData.jobId;
      setAiStage("cook");
      const deadline = Date.now() + 150000; // up to 2.5 min
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const pr = await fetch(`/api/kitchen?action=result&jobId=${encodeURIComponent(jobId)}`);
        const pd = await pr.json();
        if (pd.status === "done") {
          setAiOut(pd.result || "(no answer came back)");
          setAiEngine(pd.engine || null);
          setAiBusy(false); setAiStage(null);
          return;
        }
        if (pd.status === "error") throw new Error(pd.error || "The kitchen is closed right now.");
        // status "running" or "unknown" (brief) — keep polling
      }
      throw new Error("The kitchen took too long this time — please try again.");
    } catch (e: any) {
      setAiOut(null);
      showToast(e?.reason || e?.message || "The kitchen is closed right now.", "err");
    } finally {
      setAiBusy(false); setAiStage(null);
    }
  };

  // Load a recipe into Ask the Kitchen for substitutions/adaptation.
  const adaptRecipe = (r: Recipe) => {
    setAiRecipe({ title: r.title, ingredients: r.ingredients, steps: r.steps });
    setAiQ("");
    setAiOut(null);
    setAiEngine(null);
    setTab("ai");
  };

  // ---- derived views ----
  const visibleRecipes = useMemo(() => {
    let list = recipes.filter((r) => isOwner || !hidden.includes(r.id));
    if (cat !== "All") {
      list = list.filter((r) => (r.tag || "").toLowerCase().includes(cat.toLowerCase()));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        r.title.toLowerCase().includes(q) ||
        r.ingredients.toLowerCase().includes(q) ||
        (r.tag || "").toLowerCase().includes(q) ||
        nameFor(r.creator, profiles).toLowerCase().includes(q));
    }
    // Sort. "Newest" is the default and preserves deploy order (newest first),
    // so a user still sees their just-posted recipe at the top.
    const sorted = [...list];
    if (sortBy === "top") sorted.sort((a, b) => b.tipsTotal - a.tipsTotal || b.upvotes - a.upvotes);
    else if (sortBy === "upvoted") sorted.sort((a, b) => b.upvotes - a.upvotes || b.tipsTotal - a.tipsTotal);
    else sorted.sort((a, b) => b.createdAt - a.createdAt); // newest (default)
    return sorted;
  }, [recipes, hidden, isOwner, cat, search, profiles, sortBy]);

  const leaders = useMemo(() => {
    const byCreator: Record<string, { addr: string; tips: number; upvotes: number; count: number }> = {};
    recipes.filter((r) => !hidden.includes(r.id)).forEach((r) => {
      const k = r.creator.toLowerCase();
      if (!byCreator[k]) byCreator[k] = { addr: r.creator, tips: 0, upvotes: 0, count: 0 };
      byCreator[k].tips += r.tipsTotal; byCreator[k].upvotes += r.upvotes; byCreator[k].count += 1;
    });
    return Object.values(byCreator).sort((a, b) => b.tips - a.tips || b.upvotes - a.upvotes);
  }, [recipes, hidden]);

  // Top individual recipes — ranked by tips, then upvotes.
  const topRecipes = useMemo(() => {
    return recipes
      .filter((r) => !hidden.includes(r.id))
      .slice()
      .sort((a, b) => b.tipsTotal - a.tipsTotal || b.upvotes - a.upvotes);
  }, [recipes, hidden]);

  // The connected user's rank among cooks (for the "your rank" line).
  const myRank = useMemo(() => {
    if (!wallet) return null;
    const idx = leaders.findIndex((l) => l.addr.toLowerCase() === wallet.toLowerCase());
    return idx >= 0 ? { rank: idx + 1, of: leaders.length, ...leaders[idx] } : null;
  }, [leaders, wallet]);

  // Per-cook stats for the rank/badge engine, built from loaded data.
  const cookStats = useMemo(() => {
    const visible = recipes.filter((r) => !hidden.includes(r.id));
    const m: Record<string, CookStats> = {};
    // determine pioneers: the earliest few distinct creators by first recipe time
    const firstSeen: Record<string, number> = {};
    [...visible].sort((a, b) => a.createdAt - b.createdAt).forEach((r) => {
      const k = r.creator.toLowerCase();
      if (firstSeen[k] === undefined) firstSeen[k] = r.createdAt;
    });
    const pioneerSet = new Set(
      Object.entries(firstSeen).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([k]) => k)
    );
    const topCookAddr = leaders[0]?.addr.toLowerCase();
    visible.forEach((r) => {
      const k = r.creator.toLowerCase();
      if (!m[k]) m[k] = { address: r.creator, recipes: 0, tips: 0, upvotes: 0, topRecipeUpvotes: 0, tagCounts: {}, tipsGiven: tipsGiven[k] || 0, isPioneer: pioneerSet.has(k), heldNumberOne: k === topCookAddr };
      const cs = m[k];
      cs.recipes += 1;
      cs.tips += r.tipsTotal;
      cs.upvotes += r.upvotes;
      cs.topRecipeUpvotes = Math.max(cs.topRecipeUpvotes, r.upvotes);
      const tag = (r.tag || "").toLowerCase();
      ["breakfast", "lunch", "dinner", "dessert", "vegan", "vegetarian", "drinks", "snacks"].forEach((cat) => {
        if (tag.includes(cat)) cs.tagCounts[cat] = (cs.tagCounts[cat] || 0) + 1;
      });
    });
    return m;
  }, [recipes, hidden, tipsGiven, leaders]);

  // Helper: rank + badges for an address (applies owner overrides).
  const rankBadgesFor = (address: string) => {
    const k = address.toLowerCase();
    const s = cookStats[k] || { address, recipes: 0, tips: 0, upvotes: 0, topRecipeUpvotes: 0, tagCounts: {} };
    const ov = overrides[k] as Override | undefined;
    return { rank: rankFor(s, ov), badges: badgesFor(s, ov), stats: s };
  };

  const myRecipes = useMemo(() =>
    wallet ? recipes.filter((r) => r.creator.toLowerCase() === wallet.toLowerCase()) : [],
    [recipes, wallet]);
  const myStats = useMemo(() => ({
    count: myRecipes.length,
    tips: myRecipes.reduce((s, r) => s + r.tipsTotal, 0),
    upvotes: myRecipes.reduce((s, r) => s + r.upvotes, 0),
  }), [myRecipes]);

  const C = "var(--text)", C2 = "var(--text-2)", C3 = "var(--text-3)";

  // ---- shared recipe card renderer ----
  // Small rank pill (tier-colored) shown next to a chef's name.
  const RankTag = ({ address }: { address: string }) => {
    const { rank } = rankBadgesFor(address);
    const { TIER_STYLE } = require("@/lib/ranks");
    const ts = TIER_STYLE[rank.tier];
    return (
      <span style={{ fontSize: 10, fontWeight: 600, color: ts.color, border: `1px solid ${ts.color}55`, background: `${ts.color}18`, padding: "1px 7px", borderRadius: 20, whiteSpace: "nowrap", textShadow: ts.glow ? `0 0 8px ${ts.color}99` : "none" }}>{rank.name}</span>
    );
  };
  // Row of earned badge emojis — tap any to see what it is and how to earn it.
  const BadgeRow = ({ address, max = 6 }: { address: string; max?: number }) => {
    const { badges } = rankBadgesFor(address);
    if (!badges.length) return null;
    return (
      <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
        {badges.slice(0, max).map((b) => (
          <span key={b.id} role="button" title={`${b.name} — ${b.desc}`} onClick={(e) => { e.stopPropagation(); setBadgeInfo({ emoji: b.emoji, name: b.name, desc: b.desc }); }} style={{ fontSize: 12, cursor: "pointer" }}>{b.emoji}</span>
        ))}
      </span>
    );
  };

  const RecipeCard = (r: RecipeX) => {
    const open = expanded === r.id;
    const ings = parseList(r.ingredients);
    const steps = parseSteps(r.steps);
    const isHidden = hidden.includes(r.id);
    return (
      <article key={r.id} style={{ background: "var(--bg-raised)", border: `1px solid ${open ? "var(--border-hover)" : "var(--border)"}`, borderRadius: 12, overflow: "hidden", opacity: isHidden ? 0.55 : 1 }}>
        <div onClick={() => setExpanded(open ? null : r.id)} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", cursor: "pointer" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <i className={open ? "ti ti-chevron-down" : "ti ti-chevron-right"} style={{ fontSize: 15, color: C3, flexShrink: 0, marginTop: 3 }} aria-hidden />
              <p className="serif" style={{ fontSize: 17, margin: 0, color: C, lineHeight: 1.3, flex: 1, minWidth: 0, wordBreak: "break-word" }}>{r.title}</p>
              {r.hashVerified && <span title="Off-chain text matches the on-chain hash" style={{ color: "var(--ok)", fontSize: 13, flexShrink: 0, marginTop: 3 }}><i className="ti ti-rosette-discount-check" aria-hidden /></span>}
              {isHidden && <span style={{ fontSize: 10, color: "#c98", border: "1px solid #c98", borderRadius: 12, padding: "1px 7px", flexShrink: 0 }}>hidden</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, marginLeft: 23, flexWrap: "wrap" }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--grad)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 500, color: "#fff", flexShrink: 0 }}>{nameFor(r.creator, profiles).slice(0, 2).toUpperCase()}</span>
              <span style={{ fontSize: 12, color: C2 }}>{nameFor(r.creator, profiles)}</span>
              <RankTag address={r.creator} />
              <BadgeRow address={r.creator} />
              {r.tipsTotal > 0 && <span style={{ fontSize: 11, color: "var(--tip)", fontWeight: 500 }}>· {r.tipsTotal.toFixed(2)} LCAI</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: 23 }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => upvote(r)} disabled={busy} style={{ background: "transparent", border: "1px solid var(--border-hover)", color: C2, padding: "5px 9px", borderRadius: 8, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}><i className="ti ti-arrow-up" style={{ fontSize: 13, verticalAlign: -1 }} aria-hidden /> {r.upvotes}</button>
            <button onClick={() => adaptRecipe(r)} title="Adapt this recipe in Ask the Kitchen" style={{ background: "transparent", border: "1px solid var(--ai-border)", color: "var(--brand-2)", padding: "5px 10px", borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}><i className="ti ti-sparkles" style={{ fontSize: 12, verticalAlign: -1 }} aria-hidden /> Adapt</button>
            <button onClick={() => { setTipFor(r); setTipAmt("5"); }} style={{ background: "var(--tip-btn)", border: "none", color: "var(--tip-btn-text)", padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}>Tip</button>
            {isOwner && <button onClick={() => toggleHide(r)} disabled={busy} title={isHidden ? "Restore" : "Hide"} style={{ background: "transparent", border: "1px solid var(--border-2)", color: C3, padding: "5px 8px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}><i className={isHidden ? "ti ti-eye" : "ti ti-eye-off"} aria-hidden /></button>}
          </div>
        </div>
        <div style={{ display: "none" }} onClick={(e) => e.stopPropagation()}>
          {/* legacy actions container removed — buttons moved into the stacked header above */}
        </div>
        {open && (
          <div style={{ padding: "4px 18px 18px 39px", borderTop: "1px solid var(--border)" }}>
            {r.tag && parseList(r.tag).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "14px 0" }}>
                {parseList(r.tag).map((t, i) => <span key={i} style={{ fontSize: 11, color: "var(--chip-text)", background: "var(--chip-bg)", padding: "3px 9px", borderRadius: 20 }}>{t}</span>)}
              </div>
            )}
            {(() => {
              const structured = (r.ingredientList && r.ingredientList.length > 0) ? r.ingredientList : null;
              const fallback = structured ? [] : ings;
              if (!structured && fallback.length === 0) return null;
              return (
                <div style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 11, color: C3, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 8px" }}>Ingredients</p>
                  {structured ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {structured.map((ing, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.6 }}>
                          <span style={{ color: "var(--brand-2)", fontWeight: 500, minWidth: 70, flexShrink: 0 }}>{ing.amount}</span>
                          <span style={{ color: C2 }}>{ing.item}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 18 }}>{fallback.map((x, i) => <li key={i} style={{ fontSize: 14, color: C2, lineHeight: 1.7 }}>{x}</li>)}</ul>
                  )}
                </div>
              );
            })()}
            {steps.length > 0 && (<div><p style={{ fontSize: 11, color: C3, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 8px" }}>Steps</p><ol style={{ margin: 0, padding: 0, listStyle: "none" }}>{steps.map((x, i) => <li key={i} style={{ fontSize: 14, color: C2, lineHeight: 1.6, marginBottom: 10, display: "flex", gap: 10 }}><span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: "var(--bg-sunken)", color: C, fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span><span>{x}</span></li>)}</ol></div>)}
            {ings.length === 0 && steps.length === 0 && !(r.ingredientList && r.ingredientList.length > 0) && <p style={{ fontSize: 13, color: C3, margin: "14px 0 0" }}>No details yet.</p>}
          </div>
        )}
      </article>
    );
  };

  const tabs: [Tab, string][] = [
    ["browse", "Browse"], ["leaderboard", "Leaderboard"], ["kitchen", "My Kitchen"], ["submit", "Add"], ["ai", "Ask the Kitchen"],
  ];

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, padding: "16px 22px", background: "var(--header-bg)", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span style={{ width: 32, height: 32, borderRadius: 9, background: "var(--grad)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><i className="ti ti-flame" style={{ fontSize: 19, color: "#fff" }} aria-hidden /></span>
            <span style={{ fontSize: 21, fontWeight: 500, color: C }}>LightTable</span>
            <span style={{ fontSize: 10, color: "var(--chip-text)", background: "var(--chip-bg)", padding: "3px 8px", borderRadius: 20, letterSpacing: 0.4 }}>ON LCAI</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: C3 }}><i className="ti ti-circle-filled" style={{ fontSize: 8, color: "var(--ok)", verticalAlign: 1 }} aria-hidden /> 9200</span>
            <button onClick={toggleTheme} aria-label="Toggle theme" style={{ background: "transparent", border: "1px solid var(--border-2)", color: C2, width: 34, height: 34, borderRadius: 9, cursor: "pointer" }}><i className={dark ? "ti ti-sun" : "ti ti-moon"} style={{ fontSize: 16 }} aria-hidden /></button>
            {wallet ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!profiles[wallet.toLowerCase()]?.trim() && (
                  <button onClick={() => { setNameInput(""); setNameModal(true); }} title="Pick a chef name so people know who's cooking" style={{ background: "var(--chip-bg)", color: "var(--chip-text)", border: "1px solid var(--ai-border)", padding: "5px 10px", borderRadius: 20, fontSize: 11, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap" }}><i className="ti ti-chef-hat" style={{ fontSize: 12, verticalAlign: -1, marginRight: 3 }} aria-hidden />Set chef name</button>
                )}
                <button onClick={() => { setNameInput(profiles[wallet.toLowerCase()] || ""); setNameModal(true); }} title="Click to set or edit your chef name" style={{ background: "var(--bg-sunken)", color: C, border: "none", padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>{nameFor(wallet, profiles)} · {balance}</button>
              </div>
            ) : (
              <button onClick={connect} style={{ background: "var(--grad)", color: "#fff", border: "none", padding: "8px 17px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Connect wallet</button>
            )}
          </div>
        </header>

        <section style={{ padding: "28px 22px 18px", textAlign: "center", background: "radial-gradient(ellipse at 50% -10%, var(--hero-glow) 0%, var(--bg) 60%)" }}>
          <h1 className="serif" style={{ fontSize: 30, lineHeight: 1.18, margin: "0 0 8px", color: C, letterSpacing: "-0.4px", fontWeight: 400 }}>Share your <span style={{ background: "var(--grad)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", fontStyle: "italic" }}>table</span>.</h1>
          <p style={{ fontSize: 14, color: C2, margin: "0 auto 20px", maxWidth: 440, lineHeight: 1.6 }}>A community cookbook where good recipes earn their keep. Post a dish, tip the cooks you love in LCAI.</p>
          <div style={{ display: "inline-flex", gap: 4, background: "var(--bg-sunken)", padding: 5, borderRadius: 11, flexWrap: "wrap", justifyContent: "center" }}>
            {tabs.map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} style={{ border: "none", padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", background: tab === t ? "var(--bg-raised)" : "transparent", color: t === "ai" && tab !== t ? "var(--brand-2)" : tab === t ? C : C3, whiteSpace: "nowrap" }}>{t === "ai" && <i className="ti ti-sparkles" style={{ fontSize: 12, verticalAlign: -1, marginRight: 3 }} aria-hidden />}{label}</button>
            ))}
          </div>
          {tab !== "ai" && (
            <button onClick={() => setTab("ai")} style={{ display: "block", margin: "16px auto 0", maxWidth: 440, width: "100%", background: "var(--ai-panel)", border: "1px solid var(--ai-border)", borderRadius: 11, padding: "11px 16px", cursor: "pointer", textAlign: "left" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <i className="ti ti-sparkles" style={{ fontSize: 18, color: "var(--brand-2)", flexShrink: 0 }} aria-hidden />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: C }}>Ask the Kitchen</span>
                  <span style={{ display: "block", fontSize: 11.5, color: C2, lineHeight: 1.45 }}>Adapt any recipe or ask a cooking question — answered by real on-chain LCAI inference.</span>
                </span>
                <i className="ti ti-arrow-right" style={{ fontSize: 15, color: "var(--brand-2)", flexShrink: 0 }} aria-hidden />
              </span>
            </button>
          )}
        </section>

        <div style={{ padding: "6px 22px 48px" }}>
          {/* BROWSE */}
          {tab === "browse" && (
            <>
              <div style={{ display: "flex", gap: 8, margin: "10px 0 12px", alignItems: "center" }}>
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 9, padding: "8px 12px" }}>
                  <i className="ti ti-search" style={{ fontSize: 15, color: C3 }} aria-hidden />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search recipes, ingredients, cooks…" style={{ flex: 1, background: "transparent", border: "none", fontSize: 14, color: C }} />
                  {search && <button onClick={() => setSearch("")} style={{ background: "transparent", border: "none", color: C3, cursor: "pointer", fontSize: 14 }}>✕</button>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 6 }}>
                {CATEGORIES.map((ct) => (
                  <button key={ct} onClick={() => setCat(ct)} style={{ whiteSpace: "nowrap", border: "1px solid var(--border-2)", background: cat === ct ? "var(--grad)" : "transparent", color: cat === ct ? "#fff" : C2, padding: "5px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer" }}>{ct}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: C3, textTransform: "uppercase", letterSpacing: 0.5, marginRight: 2 }}>Sort</span>
                {([["newest", "Newest"], ["top", "Top tipped"], ["upvoted", "Most upvoted"]] as const).map(([s, label]) => (
                  <button key={s} onClick={() => setSortBy(s)} style={{ whiteSpace: "nowrap", border: "1px solid var(--border-2)", background: sortBy === s ? "var(--bg-raised)" : "transparent", color: sortBy === s ? C : C3, padding: "4px 11px", borderRadius: 20, fontSize: 12, fontWeight: sortBy === s ? 500 : 400, cursor: "pointer" }}>{label}</button>
                ))}
              </div>

              {loading ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: C3, fontSize: 14 }}><i className="ti ti-loader-2" style={{ fontSize: 18 }} aria-hidden /> Loading recipes from LCAI…</div>
              ) : visibleRecipes.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 20px", border: "1px dashed var(--border-2)", borderRadius: 12 }}>
                  <p className="serif" style={{ fontSize: 18, color: C, margin: "0 0 6px" }}>{recipes.length === 0 ? "No recipes yet." : "Nothing matches that."}</p>
                  <p style={{ fontSize: 13, color: C2, margin: "0 0 16px" }}>{recipes.length === 0 ? "Be the first to set the table." : "Try a different search or category."}</p>
                  {recipes.length === 0 && <button onClick={() => setTab("submit")} style={{ background: "var(--grad)", color: "#fff", border: "none", padding: "9px 18px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Add the first recipe</button>}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>{visibleRecipes.map(RecipeCard)}</div>
              )}
            </>
          )}

          {/* LEADERBOARD */}
          {tab === "leaderboard" && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                {([["cooks", "Top Cooks"], ["recipes", "Top Recipes"]] as const).map(([m, label]) => (
                  <button key={m} onClick={() => setLbMode(m)} style={{ border: "1px solid var(--border-2)", background: lbMode === m ? "var(--grad)" : "transparent", color: lbMode === m ? "#fff" : C2, padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>{label}</button>
                ))}
              </div>

              {/* your rank (cooks view, connected, ranked) */}
              {lbMode === "cooks" && myRank && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--ai-panel)", border: "1px solid var(--ai-border)", borderRadius: 11, padding: "10px 16px", marginBottom: 12 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--brand-2)", width: 24, textAlign: "center" }}>#{myRank.rank}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, color: C, margin: 0, fontWeight: 500 }}>You — {nameFor(myRank.addr, profiles)}</p>
                    <p style={{ fontSize: 11, color: C3, margin: 0 }}>#{myRank.rank} of {myRank.of} cooks · {myRank.count} recipe{myRank.count !== 1 ? "s" : ""} · {myRank.upvotes} upvotes</p>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 600, color: "var(--tip)" }}>{myRank.tips.toFixed(2)}</span>
                </div>
              )}

              {lbMode === "cooks" ? (
                <>
                  <p style={{ fontSize: 11, color: C3, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 14px" }}>Top cooks by tips earned</p>
                  {leaders.length === 0 ? (
                    <p style={{ fontSize: 14, color: C2, textAlign: "center", padding: "40px 0" }}>No tipped recipes yet — be the first to support a cook.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {leaders.map((l, i) => (
                        <div key={l.addr} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 11, padding: "12px 16px", outline: wallet && l.addr.toLowerCase() === wallet.toLowerCase() ? "1px solid var(--brand-2)" : "none" }}>
                          <span style={{ fontSize: 16, fontWeight: 600, color: i < 3 ? "var(--brand-2)" : C3, width: 24, textAlign: "center" }}>{i === 0 ? "🏆" : i + 1}</span>
                          <span style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--grad)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, color: "#fff" }}>{nameFor(l.addr, profiles).slice(0, 2).toUpperCase()}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 14, color: C, margin: 0, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{nameFor(l.addr, profiles)} <RankTag address={l.addr} /> <BadgeRow address={l.addr} /></p>
                            <p style={{ fontSize: 11, color: C3, margin: 0 }}>{l.count} recipe{l.count !== 1 ? "s" : ""} · {l.upvotes} upvotes</p>
                          </div>
                          <span style={{ fontSize: 16, fontWeight: 600, color: "var(--tip)" }}>{l.tips.toFixed(2)}</span>
                          {isOwner && <button onClick={() => setOwnerPanel(l.addr)} title="Manage rank & badges" style={{ background: "transparent", border: "1px solid var(--border-2)", color: C3, padding: "4px 7px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}><i className="ti ti-settings" aria-hidden /></button>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p style={{ fontSize: 11, color: C3, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 14px" }}>Top recipes by tips earned</p>
                  {topRecipes.length === 0 ? (
                    <p style={{ fontSize: 14, color: C2, textAlign: "center", padding: "40px 0" }}>No recipes yet.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {topRecipes.map((r, i) => (
                        <div key={r.id} onClick={() => { setCat("All"); setSortBy("top"); setTab("browse"); }} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 11, padding: "12px 16px", cursor: "pointer" }}>
                          <span style={{ fontSize: 16, fontWeight: 600, color: i < 3 ? "var(--brand-2)" : C3, width: 24, textAlign: "center" }}>{i === 0 ? "🏆" : i + 1}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 14, color: C, margin: 0, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</p>
                            <p style={{ fontSize: 11, color: C3, margin: 0 }}>{nameFor(r.creator, profiles)} · {r.upvotes} upvotes</p>
                          </div>
                          <span style={{ fontSize: 16, fontWeight: 600, color: "var(--tip)" }}>{r.tipsTotal.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* MY KITCHEN */}
          {tab === "kitchen" && (
            <div style={{ marginTop: 12 }}>
              {!wallet ? (
                <div style={{ textAlign: "center", padding: "48px 20px", border: "1px dashed var(--border-2)", borderRadius: 12 }}>
                  <p className="serif" style={{ fontSize: 18, color: C, margin: "0 0 6px" }}>Your kitchen</p>
                  <p style={{ fontSize: 13, color: C2, margin: "0 0 16px" }}>Connect your wallet to see your recipes, tips earned, and upvotes.</p>
                  <button onClick={connect} style={{ background: "var(--grad)", color: "#fff", border: "none", padding: "9px 18px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Connect wallet</button>
                </div>
              ) : (
                <>
                  {(() => {
                    const { rank, badges, stats } = rankBadgesFor(wallet);
                    const { TIER_STYLE } = require("@/lib/ranks");
                    const ts = TIER_STYLE[rank.tier];
                    const nr = nextRank(stats);
                    // progress: how close to clearing all three of the next rank's thresholds
                    let pct = 100;
                    if (nr) {
                      const pr = Math.min(1, stats.recipes / Math.max(1, nr.minRecipes));
                      const pt = Math.min(1, stats.tips / Math.max(1, nr.minTips || 1));
                      const pu = Math.min(1, stats.upvotes / Math.max(1, nr.minUpvotes || 1));
                      pct = Math.round(((pr + pt + pu) / 3) * 100);
                    }
                    return (
                      <div style={{ background: "var(--bg-raised)", border: `1px solid ${ts.color}55`, borderRadius: 13, padding: "16px 18px", marginBottom: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 18, fontWeight: 700, color: ts.color, textShadow: ts.glow ? `0 0 12px ${ts.color}99` : "none" }}>{rank.name}</span>
                          {badges.length > 0 && <span style={{ display: "inline-flex", gap: 4 }}>{badges.map((b: any) => <span key={b.id} role="button" title={`${b.name} — ${b.desc}`} onClick={() => setBadgeInfo({ emoji: b.emoji, name: b.name, desc: b.desc })} style={{ fontSize: 15, cursor: "pointer" }}>{b.emoji}</span>)}</span>}
                        </div>
                        {nr ? (
                          <>
                            <div style={{ marginTop: 12, height: 7, background: "var(--bg-sunken)", borderRadius: 20, overflow: "hidden" }}>
                              <div style={{ width: `${pct}%`, height: "100%", background: ts.color, borderRadius: 20, transition: "width .4s" }} />
                            </div>
                            <p style={{ fontSize: 11.5, color: C3, margin: "8px 0 0", lineHeight: 1.5 }}>
                              {pct}% to <strong style={{ color: C2 }}>{nr.name}</strong> — need {nr.minRecipes} recipes ({stats.recipes}), {nr.minTips} LCAI tipped ({stats.tips.toFixed(0)}), {nr.minUpvotes} upvotes ({stats.upvotes})
                            </p>
                          </>
                        ) : (
                          <p style={{ fontSize: 12, color: ts.color, margin: "10px 0 0", fontWeight: 500 }}>★ You've reached the top of the kitchen. Legendary.</p>
                        )}
                      </div>
                    );
                  })()}
                  <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
                    {[["Recipes", myStats.count.toString()], ["LCAI earned", myStats.tips.toFixed(2)], ["Upvotes", myStats.upvotes.toString()]].map(([k, v]) => (
                      <div key={k} style={{ flex: 1, minWidth: 100, background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 11, padding: "14px 16px" }}>
                        <p style={{ fontSize: 22, fontWeight: 600, color: k === "LCAI earned" ? "var(--tip)" : C, margin: "0 0 2px" }}>{v}</p>
                        <p style={{ fontSize: 11, color: C3, margin: 0, textTransform: "uppercase", letterSpacing: 0.6 }}>{k}</p>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 11, color: C3, textTransform: "uppercase", letterSpacing: 1 }}>Your recipes</span>
                    <button onClick={() => { setNameInput(profiles[wallet.toLowerCase()] || ""); setNameModal(true); }} style={{ background: "transparent", border: "1px solid var(--border-2)", color: C2, padding: "5px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>Edit display name</button>
                  </div>
                  {myRecipes.length === 0 ? (
                    <p style={{ fontSize: 14, color: C2, textAlign: "center", padding: "30px 0" }}>You haven't published any recipes yet.</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>{myRecipes.map(RecipeCard)}</div>
                  )}
                </>
              )}
            </div>
          )}

          {/* SUBMIT */}
          {tab === "submit" && !wallet && (
            <div style={{ textAlign: "center", padding: "48px 20px", border: "1px dashed var(--border-2)", borderRadius: 12, marginTop: 8 }}>
              <p className="serif" style={{ fontSize: 18, color: C, margin: "0 0 6px" }}>Connect to add a recipe</p>
              <p style={{ fontSize: 13, color: C2, margin: "0 0 16px" }}>Publishing anchors your recipe on-chain, so you'll need your wallet connected first.</p>
              <button onClick={connect} style={{ background: "var(--grad)", color: "#fff", border: "none", padding: "9px 18px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Connect wallet</button>
            </div>
          )}

          {tab === "submit" && wallet && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
              <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 13, padding: 19 }}>
                <div style={{ marginBottom: 15 }}>
                  <label style={{ display: "block", fontSize: 11, color: C2, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Recipe title</label>
                  <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="Grandma's olive-oil banana bread" style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-2)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: C }} />
                </div>
                <div style={{ marginBottom: 15 }}>
                  <label style={{ display: "block", fontSize: 11, color: C2, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Category</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {CATEGORIES.filter((x) => x !== "All").map((ct) => (
                      <button key={ct} onClick={() => setFCat(ct)} style={{ border: "1px solid var(--border-2)", background: fCat === ct ? "var(--grad)" : "transparent", color: fCat === ct ? "#fff" : C2, padding: "5px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer" }}>{ct}</button>
                    ))}
                  </div>
                </div>

                {/* structured ingredients */}
                <div style={{ marginBottom: 15 }}>
                  <label style={{ display: "block", fontSize: 11, color: C2, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>Ingredients</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {fIngRows.map((row, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input value={row.amount} onChange={(e) => { const next = [...fIngRows]; next[i] = { ...next[i], amount: e.target.value }; setFIngRows(next); }} placeholder="2 cups" style={{ width: 90, flexShrink: 0, background: "var(--bg-input)", border: "1px solid var(--border-2)", borderRadius: 8, padding: "9px 10px", fontSize: 14, color: C }} />
                        <input value={row.item} onChange={(e) => { const next = [...fIngRows]; next[i] = { ...next[i], item: e.target.value }; setFIngRows(next); }}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (i === fIngRows.length - 1) setFIngRows([...fIngRows, { amount: "", item: "" }]); } }}
                          placeholder="all-purpose flour" style={{ flex: 1, background: "var(--bg-input)", border: "1px solid var(--border-2)", borderRadius: 8, padding: "9px 10px", fontSize: 14, color: C }} />
                        <button onClick={() => setFIngRows(fIngRows.length > 1 ? fIngRows.filter((_, j) => j !== i) : [{ amount: "", item: "" }])} aria-label="Remove ingredient" style={{ flexShrink: 0, width: 32, height: 32, background: "transparent", border: "1px solid var(--border-2)", borderRadius: 8, color: C3, cursor: "pointer" }}><i className="ti ti-x" style={{ fontSize: 14 }} aria-hidden /></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setFIngRows([...fIngRows, { amount: "", item: "" }])} style={{ marginTop: 8, background: "transparent", border: "1px dashed var(--border-hover)", color: C2, padding: "7px 12px", borderRadius: 8, fontSize: 13, cursor: "pointer", width: "100%" }}><i className="ti ti-plus" style={{ fontSize: 13, verticalAlign: -1 }} aria-hidden /> Add ingredient</button>
                  <p style={{ fontSize: 11, color: C3, margin: "7px 2px 0" }}>Amount on the left (e.g. “2 cups”), ingredient on the right. Press Enter to add another.</p>
                </div>

                {/* steps with live numbering */}
                <div style={{ marginBottom: 15 }}>
                  <label style={{ display: "block", fontSize: 11, color: C2, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Steps — one per line</label>
                  <textarea value={fSteps} onChange={(e) => setFSteps(e.target.value)} placeholder={"Mash the bananas\nWhisk in oil and sugar\nFold in flour and bake 30 min"} rows={4} style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-2)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: C, resize: "vertical" }} />
                  {parseSteps(fSteps).length > 0 && (
                    <div style={{ marginTop: 8, background: "var(--bg-sunken)", borderRadius: 8, padding: "10px 12px" }}>
                      <p style={{ fontSize: 10, color: C3, textTransform: "uppercase", letterSpacing: 0.7, margin: "0 0 6px" }}>Preview</p>
                      <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
                        {parseSteps(fSteps).map((s, i) => (
                          <li key={i} style={{ fontSize: 13, color: C2, lineHeight: 1.5, marginBottom: 5, display: "flex", gap: 8 }}>
                            <span style={{ flexShrink: 0, width: 18, height: 18, borderRadius: "50%", background: "var(--grad)", color: "#fff", fontSize: 10, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: 15 }}>
                  <label style={{ display: "block", fontSize: 11, color: C2, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Extra tags (optional)</label>
                  <input value={fTag} onChange={(e) => setFTag(e.target.value)} placeholder="30 min, gluten-free, spicy" style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-2)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: C }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: C3 }}><i className="ti ti-lock" style={{ fontSize: 13, verticalAlign: -1 }} aria-hidden /> off-chain text · hash anchored on-chain · free to post</span>
                  <button onClick={submit} disabled={busy} style={{ background: "var(--grad)", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1 }}>{busy ? "Publishing…" : "Publish recipe"}</button>
                </div>
              </div>

              {/* live preview of the finished recipe */}
              {(fTitle.trim() || fIngRows.some((r) => r.item.trim()) || fSteps.trim()) && (
                <div>
                  <p style={{ fontSize: 11, color: C3, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 8px 2px" }}>Live preview</p>
                  <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border-hover)", borderRadius: 12, padding: "16px 18px" }}>
                    <p className="serif" style={{ fontSize: 18, margin: "0 0 8px", color: C }}>{fTitle.trim() || "Untitled recipe"}</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                      {[fCat, ...parseList(fTag)].filter(Boolean).map((t, i) => <span key={i} style={{ fontSize: 11, color: "var(--chip-text)", background: "var(--chip-bg)", padding: "3px 9px", borderRadius: 20 }}>{t}</span>)}
                    </div>
                    {fIngRows.some((r) => r.item.trim()) && (
                      <div style={{ marginBottom: 14 }}>
                        <p style={{ fontSize: 11, color: C3, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 6px" }}>Ingredients</p>
                        {fIngRows.filter((r) => r.item.trim()).map((r, i) => (
                          <div key={i} style={{ display: "flex", gap: 10, fontSize: 14, lineHeight: 1.6 }}>
                            <span style={{ color: "var(--brand-2)", fontWeight: 500, minWidth: 70, flexShrink: 0 }}>{r.amount}</span>
                            <span style={{ color: C2 }}>{r.item}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {parseSteps(fSteps).length > 0 && (
                      <div>
                        <p style={{ fontSize: 11, color: C3, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 6px" }}>Steps</p>
                        <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
                          {parseSteps(fSteps).map((s, i) => (
                            <li key={i} style={{ fontSize: 14, color: C2, lineHeight: 1.6, marginBottom: 8, display: "flex", gap: 10 }}>
                              <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: "var(--bg-sunken)", color: C, fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AI */}
          {tab === "ai" && (
            <div style={{ marginTop: 8 }}>
              <div style={{ background: "var(--ai-panel)", border: "1px solid var(--ai-border)", borderRadius: 13, padding: 19 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 13 }}>
                  <i className="ti ti-sparkles" style={{ fontSize: 19, color: "var(--brand-2)" }} aria-hidden />
                  <span style={{ fontSize: 14, fontWeight: 500, color: C }}>Ask the Kitchen</span>
                  <span style={{ fontSize: 10, color: "var(--chip-text)", background: "var(--chip-bg)", padding: "3px 8px", borderRadius: 20, letterSpacing: 0.3 }}>LCAI</span>
                </div>

                {aiRecipe && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "var(--bg-input)", border: "1px solid var(--ai-border)", borderRadius: 8, padding: "8px 11px", marginBottom: 11 }}>
                    <span style={{ fontSize: 12, color: C2 }}>Adapting: <strong style={{ color: C }}>{aiRecipe.title}</strong></span>
                    <button onClick={() => setAiRecipe(null)} style={{ background: "transparent", border: "none", color: C3, fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>clear</button>
                  </div>
                )}

                <input value={aiQ} onChange={(e) => setAiQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !aiBusy) askKitchen(); }} placeholder={aiRecipe ? "I don't have buttermilk — what can I use instead?" : "How do I keep pasta from sticking?"} style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--ai-border)", borderRadius: 8, padding: "11px 13px", fontSize: 14, color: C, marginBottom: 13 }} />
                <button onClick={askKitchen} disabled={aiBusy} style={{ background: "var(--grad)", color: "#fff", border: "none", padding: "10px 20px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: aiBusy ? "wait" : "pointer", opacity: aiBusy ? 0.8 : 1 }}>{aiBusy ? (aiStage === "pay" ? "Confirm payment in wallet…" : aiStage === "starting" ? "Payment received — firing up…" : "The kitchen is cooking…") : `Ask the kitchen · ${AI_FEE_LCAI} LCAI ↗`}</button>

                {aiBusy && aiStage === "pay" && <p style={{ fontSize: 11, color: C3, margin: "12px 2px 0", lineHeight: 1.55 }}>Open your wallet app to approve the {AI_FEE_LCAI} LCAI payment, then come back here.</p>}
                {aiBusy && aiStage === "starting" && <p style={{ fontSize: 11, color: C3, margin: "12px 2px 0", lineHeight: 1.55 }}>Payment confirmed — sending your request to the LCAI workers…</p>}
                {aiBusy && aiStage === "cook" && <p style={{ fontSize: 11, color: C3, margin: "12px 2px 0", lineHeight: 1.55 }}>Running a live inference job on LCAI workers — this can take up to a minute.</p>}
                {!aiBusy && <p style={{ fontSize: 11, color: C3, margin: "10px 2px 0", lineHeight: 1.55 }}>Each request runs a real LCAI inference job. A small {AI_FEE_LCAI} LCAI fee covers it.</p>}

                {aiOut && (
                  <div style={{ marginTop: 15 }}>
                    {aiEngine && <div style={{ fontSize: 10, color: "var(--chip-text)", marginBottom: 6, letterSpacing: 0.3 }}>{aiEngine === "lcai" ? "↳ answered by native LCAI inference" : "↳ answered by fallback engine"}</div>}
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: C2, borderLeft: "2px solid var(--ai-rule)", paddingLeft: 13, whiteSpace: "pre-wrap" }}>{aiOut}</div>
                  </div>
                )}
              </div>
              <p style={{ fontSize: 11, color: C3, margin: "11px 2px 0", lineHeight: 1.55 }}>Each answer runs as a real inference job on LCAI workers — on-chain AI, not a wrapper around someone else's API.</p>
            </div>
          )}
        </div>
      </div>

      {/* tip modal */}
      {tipFor && (
        <div onClick={() => setTipFor(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, maxWidth: 360, width: "100%" }}>
            <p className="serif" style={{ fontSize: 18, color: C, margin: "0 0 4px" }}>Tip this cook</p>
            <p style={{ fontSize: 13, color: C2, margin: "0 0 16px" }}>{tipFor.title} · {nameFor(tipFor.creator, profiles)}</p>
            <label style={{ display: "block", fontSize: 11, color: C2, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Amount (LCAI)</label>
            <input value={tipAmt} onChange={(e) => setTipAmt(e.target.value)} inputMode="decimal" style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-2)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: C, marginBottom: 8 }} />
            <p style={{ fontSize: 11, color: C3, margin: "0 0 16px" }}>95% to the cook, 5% to the platform — one signature.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setTipFor(null)} style={{ background: "transparent", border: "1px solid var(--border-2)", color: C2, padding: "8px 16px", borderRadius: 9, fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={doTip} disabled={busy} style={{ background: "var(--tip-btn)", border: "none", color: "var(--tip-btn-text)", padding: "8px 18px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: busy ? "wait" : "pointer" }}>{busy ? "Tipping…" : "Send tip"}</button>
            </div>
          </div>
        </div>
      )}

      {/* wallet chooser modal */}
      {walletModal && (
        <div onClick={() => setWalletModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, maxWidth: 360, width: "100%" }}>
            <p className="serif" style={{ fontSize: 18, color: C, margin: "0 0 4px" }}>Connect a wallet</p>
            <p style={{ fontSize: 12, color: C2, margin: "0 0 18px" }}>Pick how you'd like to connect. On a phone, use WalletConnect.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => finishConnect("injected")} disabled={busy || !hasInjected()} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg-sunken)", border: "1px solid var(--border-2)", color: C, padding: "13px 15px", borderRadius: 11, fontSize: 14, fontWeight: 500, cursor: hasInjected() ? "pointer" : "not-allowed", opacity: hasInjected() ? 1 : 0.5, textAlign: "left" }}>
                <i className="ti ti-browser" style={{ fontSize: 20, color: "var(--brand-2)" }} aria-hidden />
                <span style={{ flex: 1 }}>Browser wallet<br /><span style={{ fontSize: 11, color: C3, fontWeight: 400 }}>{hasInjected() ? "MetaMask or similar extension" : "No extension detected"}</span></span>
              </button>
              <button onClick={() => finishConnect("walletconnect")} disabled={busy} style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg-sunken)", border: "1px solid var(--border-2)", color: C, padding: "13px 15px", borderRadius: 11, fontSize: 14, fontWeight: 500, cursor: "pointer", textAlign: "left" }}>
                <i className="ti ti-qrcode" style={{ fontSize: 20, color: "var(--brand-2)" }} aria-hidden />
                <span style={{ flex: 1 }}>WalletConnect<br /><span style={{ fontSize: 11, color: C3, fontWeight: 400 }}>Phone wallets — scan a QR or open your app</span></span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* name modal */}
      {ownerPanel && isOwner && (() => {
        const { rank, stats } = rankBadgesFor(ownerPanel);
        const { RANKS, BADGES } = require("@/lib/ranks");
        const cur = (overrides[ownerPanel.toLowerCase()] || {}) as Override;
        const earnedIds = new Set(rankBadgesFor(ownerPanel).badges.map((b: any) => b.id));
        return (
          <div onClick={() => setOwnerPanel(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, maxWidth: 420, width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
              <p className="serif" style={{ fontSize: 18, color: C, margin: "0 0 4px" }}>Manage {nameFor(ownerPanel, profiles)}</p>
              <p style={{ fontSize: 12, color: C2, margin: "0 0 14px" }}>Owner controls. Currently {rank.name} · {stats.recipes} recipes, {stats.tips.toFixed(0)} LCAI, {stats.upvotes} upvotes. You'll sign (free, no gas).</p>

              <label style={{ display: "block", fontSize: 11, color: C2, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Force rank (optional)</label>
              <select defaultValue={cur.rankLevel ?? ""} id="ovRank" style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-2)", borderRadius: 8, padding: "9px 12px", fontSize: 13, color: C, marginBottom: 14 }}>
                <option value="">— earned rank (no override) —</option>
                {RANKS.map((r: any) => <option key={r.level} value={r.level}>{r.level}. {r.name}</option>)}
              </select>

              <label style={{ display: "block", fontSize: 11, color: C2, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Badges (tap to grant / revoke)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
                {BADGES.map((b: any) => {
                  const granted = (cur.grant || []).includes(b.id);
                  const revoked = (cur.revoke || []).includes(b.id);
                  const has = earnedIds.has(b.id);
                  return (
                    <button key={b.id} id={`badge-${b.id}`} data-state={granted ? "grant" : revoked ? "revoke" : "auto"} title={b.desc} onClick={(e) => { const el = e.currentTarget; const s = el.getAttribute("data-state"); const ns = s === "auto" ? "grant" : s === "grant" ? "revoke" : "auto"; el.setAttribute("data-state", ns); el.style.opacity = ns === "revoke" ? "0.4" : "1"; el.style.borderColor = ns === "grant" ? "var(--ok)" : "var(--border-2)"; }} style={{ background: "var(--bg-input)", border: `1px solid ${granted ? "var(--ok)" : "var(--border-2)"}`, opacity: revoked ? 0.4 : 1, color: C2, padding: "5px 9px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>{b.emoji} {b.name}{has ? " ✓" : ""}</button>
                  );
                })}
              </div>
              <p style={{ fontSize: 10.5, color: C3, margin: "0 0 14px", lineHeight: 1.5 }}>Tap a badge: green border = force-grant, faded = force-revoke, normal = auto (earned). ✓ = currently earned.</p>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setOwnerPanel(null)} style={{ background: "transparent", border: "1px solid var(--border-2)", color: C2, padding: "8px 16px", borderRadius: 9, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                <button disabled={busy} onClick={() => {
                  const rankSel = (document.getElementById("ovRank") as HTMLSelectElement)?.value;
                  const grant: string[] = []; const revoke: string[] = [];
                  BADGES.forEach((b: any) => { const st = document.getElementById(`badge-${b.id}`)?.getAttribute("data-state"); if (st === "grant") grant.push(b.id); if (st === "revoke") revoke.push(b.id); });
                  const ov: Override = {};
                  if (rankSel) ov.rankLevel = Number(rankSel);
                  if (grant.length) ov.grant = grant;
                  if (revoke.length) ov.revoke = revoke;
                  saveOverride(ownerPanel, ov);
                }} style={{ background: "var(--grad)", border: "none", color: "#fff", padding: "8px 18px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: busy ? "wait" : "pointer" }}>{busy ? "Saving…" : "Sign & save"}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {nameModal && (
        <div onClick={() => setNameModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 14, padding: 22, maxWidth: 360, width: "100%" }}>
            <p className="serif" style={{ fontSize: 18, color: C, margin: "0 0 4px" }}>Display name</p>
            <p style={{ fontSize: 12, color: C2, margin: "0 0 16px" }}>A friendly name shown on your recipes. Cosmetic — your wallet address stays your real identity. You'll sign to prove it's you (free, no gas).</p>
            <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} maxLength={32} placeholder="ChefRok" style={{ width: "100%", background: "var(--bg-input)", border: "1px solid var(--border-2)", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: C, marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
              <button onClick={async () => { setNameModal(false); await disconnect(); }} style={{ background: "transparent", border: "none", color: C3, padding: "8px 4px", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>Disconnect</button>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setNameModal(false)} style={{ background: "transparent", border: "1px solid var(--border-2)", color: C2, padding: "8px 16px", borderRadius: 9, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                <button onClick={saveName} disabled={busy} style={{ background: "var(--grad)", border: "none", color: "#fff", padding: "8px 18px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: busy ? "wait" : "pointer" }}>{busy ? "Saving…" : "Sign & save"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {badgeInfo && (
        <div onClick={() => setBadgeInfo(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 55 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 14, padding: "24px 22px", maxWidth: 320, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 44, marginBottom: 8 }}>{badgeInfo.emoji}</div>
            <p className="serif" style={{ fontSize: 19, color: C, margin: "0 0 6px" }}>{badgeInfo.name}</p>
            <p style={{ fontSize: 11, color: C3, textTransform: "uppercase", letterSpacing: 0.8, margin: "0 0 8px" }}>How to earn it</p>
            <p style={{ fontSize: 14, color: C2, margin: "0 0 18px", lineHeight: 1.5 }}>{badgeInfo.desc}</p>
            <button onClick={() => setBadgeInfo(null)} style={{ background: "var(--grad)", border: "none", color: "#fff", padding: "8px 20px", borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>Got it</button>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: toast.kind === "err" ? "#7a1f2b" : "var(--toast-bg)", color: "var(--toast-text)", padding: "11px 18px", borderRadius: 10, fontSize: 13, maxWidth: 440, zIndex: 60, boxShadow: "0 4px 20px rgba(0,0,0,0.25)" }}>{toast.msg}</div>
      )}
    </main>
  );
}
