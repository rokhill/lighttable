"use client";
import React, { useEffect, useMemo, useState, useRef } from "react";

// ---------------------------------------------------------------------------
// Cook Mode — the "on the counter" experience. Full-screen, big text, one step
// at a time, ingredients pinned, a servings scaler, per-step timers, screen
// wake-lock so the phone doesn't sleep mid-cook, and a button to ask the
// kitchen for help without leaving your place.
// ---------------------------------------------------------------------------

interface IngRow { amount: string; item: string }

export interface CookModeProps {
  title: string;
  ingredients: IngRow[];      // structured rows when available
  ingredientsFallback: string[]; // plain strings when no structured list
  steps: string[];
  baseServings?: number;      // if known; defaults to 4 for scaling
  onClose: () => void;
  onAskKitchen: () => void;   // hands the recipe to Ask the Kitchen
}

// Try to scale a quantity string ("1 1/2 cups", "200g", "2") by a factor.
// Leaves non-numeric amounts ("a pinch") untouched.
function scaleAmount(amount: string, factor: number): string {
  if (!amount || factor === 1) return amount;
  // handle mixed numbers and fractions like "1 1/2", "3/4", "2"
  const m = amount.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)/);
  if (!m) return amount;
  const numStr = m[1];
  let value = 0;
  if (numStr.includes(" ")) {
    const [whole, frac] = numStr.split(/\s+/);
    const [n, d] = frac.split("/").map(Number);
    value = Number(whole) + n / d;
  } else if (numStr.includes("/")) {
    const [n, d] = numStr.split("/").map(Number);
    value = n / d;
  } else {
    value = parseFloat(numStr);
  }
  const scaled = value * factor;
  // round to a tidy value
  const tidy = Math.round(scaled * 100) / 100;
  const rest = amount.slice(numStr.length);
  return `${tidy}${rest}`;
}

// Pull a timer duration (in seconds) out of a step's text, e.g. "simmer 10 min",
// "bake for 1 hour", "rest 30 seconds". Returns null if none found.
function detectTimer(step: string): number | null {
  const s = step.toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)\s*(hour|hr|minute|min|second|sec)s?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2];
  if (unit.startsWith("hour") || unit === "hr") return Math.round(n * 3600);
  if (unit.startsWith("min")) return Math.round(n * 60);
  return Math.round(n);
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function CookMode({ title, ingredients, ingredientsFallback, steps, baseServings = 4, onClose, onAskKitchen }: CookModeProps) {
  const [idx, setIdx] = useState(0);
  const [servings, setServings] = useState(baseServings);
  const [showIngredients, setShowIngredients] = useState(false);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [timer, setTimer] = useState<{ remaining: number; running: boolean } | null>(null);
  const wakeRef = useRef<any>(null);

  const factor = servings / baseServings;
  const total = steps.length;
  const stepTimer = useMemo(() => detectTimer(steps[idx] || ""), [steps, idx]);

  // Screen wake-lock — keep the phone awake while cooking.
  useEffect(() => {
    let released = false;
    (async () => {
      try {
        // @ts-ignore - wakeLock not in older TS lib defs
        if (navigator.wakeLock) wakeRef.current = await navigator.wakeLock.request("screen");
      } catch { /* not supported / denied — fine */ }
    })();
    const reacquire = async () => {
      try {
        // @ts-ignore
        if (document.visibilityState === "visible" && navigator.wakeLock && !released) {
          // @ts-ignore
          wakeRef.current = await navigator.wakeLock.request("screen");
        }
      } catch {}
    };
    document.addEventListener("visibilitychange", reacquire);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", reacquire);
      try { wakeRef.current?.release?.(); } catch {}
    };
  }, []);

  // Timer tick.
  useEffect(() => {
    if (!timer?.running) return;
    if (timer.remaining <= 0) { setTimer((t) => t && { ...t, running: false }); return; }
    const id = setTimeout(() => setTimer((t) => t && { ...t, remaining: t.remaining - 1 }), 1000);
    return () => clearTimeout(id);
  }, [timer]);

  // Reset/seed timer when the step changes.
  useEffect(() => {
    if (stepTimer) setTimer({ remaining: stepTimer, running: false });
    else setTimer(null);
  }, [stepTimer, idx]);

  const C = "var(--text-1)", C2 = "var(--text-2)", C3 = "var(--text-3)";

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-0)", zIndex: 100, display: "flex", flexDirection: "column" }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
        <button onClick={onClose} style={{ background: "transparent", border: "none", color: C2, fontSize: 22, cursor: "pointer", lineHeight: 1 }} aria-label="Close Cook Mode">✕</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</p>
          <p style={{ margin: 0, fontSize: 12, color: C3 }}>Step {idx + 1} of {total}</p>
        </div>
        <button onClick={() => setShowIngredients((v) => !v)} style={{ background: showIngredients ? "var(--grad)" : "transparent", color: showIngredients ? "#fff" : C2, border: "1px solid var(--border-2)", padding: "6px 12px", borderRadius: 9, fontSize: 12, cursor: "pointer" }}>Ingredients</button>
      </div>

      {/* progress bar */}
      <div style={{ height: 4, background: "var(--bg-sunken)" }}>
        <div style={{ height: "100%", width: `${((idx + 1) / total) * 100}%`, background: "var(--grad)", transition: "width .3s" }} />
      </div>

      {/* body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 22px" }}>
        {showIngredients ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <span style={{ fontSize: 13, color: C3, textTransform: "uppercase", letterSpacing: 0.8 }}>Ingredients</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: C3 }}>Servings</span>
                <button onClick={() => setServings((s) => Math.max(1, s - 1))} style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border-2)", background: "transparent", color: C, fontSize: 16, cursor: "pointer" }}>−</button>
                <span style={{ fontSize: 15, fontWeight: 600, color: C, minWidth: 20, textAlign: "center" }}>{servings}</span>
                <button onClick={() => setServings((s) => s + 1)} style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border-2)", background: "transparent", color: C, fontSize: 16, cursor: "pointer" }}>+</button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ingredients.length > 0 ? ingredients.map((ing, i) => (
                <label key={i} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 17, color: checked[i + 1000] ? C3 : C, textDecoration: checked[i + 1000] ? "line-through" : "none", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!checked[i + 1000]} onChange={() => setChecked((c) => ({ ...c, [i + 1000]: !c[i + 1000] }))} style={{ width: 20, height: 20, flexShrink: 0 }} />
                  <span><strong style={{ color: factor !== 1 ? "var(--brand-2)" : "inherit" }}>{scaleAmount(ing.amount, factor)}</strong> {ing.item}</span>
                </label>
              )) : ingredientsFallback.map((ing, i) => (
                <label key={i} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 17, color: checked[i + 1000] ? C3 : C, textDecoration: checked[i + 1000] ? "line-through" : "none", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!checked[i + 1000]} onChange={() => setChecked((c) => ({ ...c, [i + 1000]: !c[i + 1000] }))} style={{ width: 20, height: 20, flexShrink: 0 }} />
                  <span>{ing}</span>
                </label>
              ))}
            </div>
            {factor !== 1 && <p style={{ fontSize: 12, color: C3, marginTop: 16 }}>Amounts scaled {factor.toFixed(2)}× for {servings} servings (from {baseServings}). Tap-counts are approximate.</p>}
          </div>
        ) : (
          <div style={{ maxWidth: 620, margin: "0 auto" }}>
            <div style={{ fontSize: 13, color: "var(--brand-2)", fontWeight: 600, letterSpacing: 0.5, marginBottom: 12 }}>STEP {idx + 1}</div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={!!checked[idx]} onChange={() => setChecked((c) => ({ ...c, [idx]: !c[idx] }))} style={{ width: 24, height: 24, flexShrink: 0, marginTop: 6 }} />
              <span style={{ fontSize: 23, lineHeight: 1.5, color: checked[idx] ? C3 : C, textDecoration: checked[idx] ? "line-through" : "none" }}>{steps[idx]}</span>
            </label>

            {/* per-step timer */}
            {timer && (
              <div style={{ marginTop: 26, display: "flex", alignItems: "center", gap: 14, background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px" }}>
                <i className="ti ti-clock" style={{ fontSize: 22, color: "var(--brand-2)" }} aria-hidden />
                <span style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: timer.remaining === 0 ? "var(--ok)" : C }}>{timer.remaining === 0 ? "Done!" : fmt(timer.remaining)}</span>
                {timer.remaining > 0 && (
                  <button onClick={() => setTimer((t) => t && { ...t, running: !t.running })} style={{ marginLeft: "auto", background: timer.running ? "transparent" : "var(--grad)", color: timer.running ? C2 : "#fff", border: timer.running ? "1px solid var(--border-2)" : "none", padding: "8px 18px", borderRadius: 9, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>{timer.running ? "Pause" : "Start"}</button>
                )}
                {timer.remaining === 0 && <button onClick={() => setTimer({ remaining: stepTimer || 0, running: false })} style={{ marginLeft: "auto", background: "transparent", color: C2, border: "1px solid var(--border-2)", padding: "8px 16px", borderRadius: 9, fontSize: 13, cursor: "pointer" }}>Reset</button>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* bottom controls */}
      <div style={{ borderTop: "1px solid var(--border)", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <button onClick={onAskKitchen} style={{ width: "100%", background: "var(--ai-panel)", border: "1px solid var(--ai-border)", color: "var(--brand-2)", padding: "11px", borderRadius: 11, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
          <i className="ti ti-sparkles" style={{ fontSize: 15, verticalAlign: -2, marginRight: 6 }} aria-hidden />Stuck? Ask the Kitchen
        </button>
        <div style={{ display: "flex", gap: 12 }}>
          <button disabled={idx === 0} onClick={() => { setShowIngredients(false); setIdx((i) => Math.max(0, i - 1)); }} style={{ flex: 1, background: "transparent", border: "1px solid var(--border-2)", color: idx === 0 ? C3 : C, padding: "14px", borderRadius: 11, fontSize: 15, fontWeight: 500, cursor: idx === 0 ? "default" : "pointer", opacity: idx === 0 ? 0.5 : 1 }}>← Back</button>
          {idx < total - 1 ? (
            <button onClick={() => { setShowIngredients(false); setIdx((i) => Math.min(total - 1, i + 1)); }} style={{ flex: 2, background: "var(--grad)", border: "none", color: "#fff", padding: "14px", borderRadius: 11, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Next step →</button>
          ) : (
            <button onClick={onClose} style={{ flex: 2, background: "var(--ok)", border: "none", color: "#fff", padding: "14px", borderRadius: 11, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>✓ Done cooking</button>
          )}
        </div>
      </div>
    </div>
  );
}
