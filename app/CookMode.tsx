"use client";
import React, { useEffect, useMemo, useState, useRef } from "react";

// ---------------------------------------------------------------------------
// Cook Mode — the "on the counter" view. Shows the WHOLE recipe at once, big and
// readable for a propped-up phone: servings scaler, all ingredients + all steps
// (check them off), tap-to-start timers on steps that mention a time, screen
// wake-lock so the phone stays awake, and Ask the Kitchen pinned at the bottom
// so you can get help without losing your place. Full recipe = you can prep
// ahead, unlike a rigid one-step-at-a-time view.
// ---------------------------------------------------------------------------

interface IngRow { amount: string; item: string }

export interface CookModeProps {
  title: string;
  ingredients: IngRow[];
  ingredientsFallback: string[];
  steps: string[];
  baseServings?: number;
  onClose: () => void;
  onAskKitchen: () => void;
}

function scaleAmount(amount: string, factor: number): string {
  if (!amount || factor === 1) return amount;
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
  const tidy = Math.round(value * factor * 100) / 100;
  return `${tidy}${amount.slice(numStr.length)}`;
}

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
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// One step row — checkable, with an inline timer if the text mentions a time.
function StepRow({ n, text, done, onToggle, C, C2, C3 }: { n: number; text: string; done: boolean; onToggle: () => void; C: string; C2: string; C3: string }) {
  const seed = useMemo(() => detectTimer(text), [text]);
  const [timer, setTimer] = useState<{ remaining: number; running: boolean } | null>(null);

  useEffect(() => {
    if (!timer?.running) return;
    if (timer.remaining <= 0) { setTimer((t) => t && { ...t, running: false }); return; }
    const id = setTimeout(() => setTimer((t) => t && { ...t, remaining: t.remaining - 1 }), 1000);
    return () => clearTimeout(id);
  }, [timer]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "16px 0", borderBottom: "1px solid var(--border)" }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 14, cursor: "pointer" }}>
        <span style={{ flexShrink: 0, width: 30, height: 30, borderRadius: "50%", background: done ? "var(--ok)" : "var(--bg-sunken)", color: done ? "#fff" : C2, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600, marginTop: 2 }}>{done ? "✓" : n}</span>
        <input type="checkbox" checked={done} onChange={onToggle} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
        <span style={{ fontSize: 19, lineHeight: 1.55, color: done ? C3 : C, textDecoration: done ? "line-through" : "none" }}>{text}</span>
      </label>
      {seed && (
        <div style={{ marginLeft: 44, display: "inline-flex", alignItems: "center", gap: 12, background: "var(--bg-sunken)", borderRadius: 10, padding: "8px 14px", alignSelf: "flex-start" }}>
          <i className="ti ti-clock" style={{ fontSize: 18, color: "var(--brand-2)" }} aria-hidden />
          <span style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: timer && timer.remaining === 0 ? "var(--ok)" : C }}>{timer ? (timer.remaining === 0 ? "Done!" : fmt(timer.remaining)) : fmt(seed)}</span>
          {(!timer || timer.remaining > 0) && (
            <button onClick={() => setTimer((t) => t ? { ...t, running: !t.running } : { remaining: seed, running: true })} style={{ background: timer?.running ? "transparent" : "var(--grad)", color: timer?.running ? C2 : "#fff", border: timer?.running ? "1px solid var(--border-2)" : "none", padding: "5px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>{timer?.running ? "Pause" : timer ? "Resume" : "Start"}</button>
          )}
          {timer && timer.remaining === 0 && <button onClick={() => setTimer({ remaining: seed, running: false })} style={{ background: "transparent", color: C2, border: "1px solid var(--border-2)", padding: "5px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>Reset</button>}
        </div>
      )}
    </div>
  );
}

export default function CookMode({ title, ingredients, ingredientsFallback, steps, baseServings = 4, onClose, onAskKitchen }: CookModeProps) {
  const [servings, setServings] = useState(baseServings);
  const [doneSteps, setDoneSteps] = useState<Record<number, boolean>>({});
  const [doneIngs, setDoneIngs] = useState<Record<number, boolean>>({});
  const wakeRef = useRef<any>(null);
  const factor = servings / baseServings;

  // Screen wake-lock — keep the phone awake while cooking.
  useEffect(() => {
    let released = false;
    const acquire = async () => {
      try {
        // @ts-ignore
        if (navigator.wakeLock && !released) wakeRef.current = await navigator.wakeLock.request("screen");
      } catch {}
    };
    acquire();
    const reacquire = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", reacquire);
    return () => { released = true; document.removeEventListener("visibilitychange", reacquire); try { wakeRef.current?.release?.(); } catch {} };
  }, []);

  const C = "var(--text-1)", C2 = "var(--text-2)", C3 = "var(--text-3)";
  const hasIngs = ingredients.length > 0 || ingredientsFallback.length > 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg)", zIndex: 100, display: "flex", flexDirection: "column" }}>
      {/* solid backdrop so the page behind is fully hidden */}
      <div style={{ position: "absolute", inset: 0, background: "var(--bg)", zIndex: -1 }} />

      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
        <button onClick={onClose} style={{ background: "transparent", border: "none", color: C2, fontSize: 22, cursor: "pointer", lineHeight: 1 }} aria-label="Close Cook Mode">✕</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 11, color: "var(--brand-2)", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase" }}>Cook Mode</p>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</p>
        </div>
      </div>

      {/* scrollable full recipe */}
      <div style={{ flex: 1, overflowY: "auto", padding: "22px 20px 28px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          {/* ingredients with servings scaler */}
          {hasIngs && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                <span style={{ fontSize: 13, color: C3, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>Ingredients</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: C3 }}>Servings</span>
                  <button onClick={() => setServings((s) => Math.max(1, s - 1))} style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--border-2)", background: "transparent", color: C, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>−</button>
                  <span style={{ fontSize: 16, fontWeight: 700, color: C, minWidth: 22, textAlign: "center" }}>{servings}</span>
                  <button onClick={() => setServings((s) => s + 1)} style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--border-2)", background: "transparent", color: C, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>+</button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {(ingredients.length > 0 ? ingredients.map((ing, i) => ({ key: i, node: <span><strong style={{ color: factor !== 1 ? "var(--brand-2)" : "inherit" }}>{scaleAmount(ing.amount, factor)}</strong> {ing.item}</span> }))
                  : ingredientsFallback.map((ing, i) => ({ key: i, node: <span>{ing}</span> }))
                ).map(({ key, node }) => (
                  <label key={key} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 17, color: doneIngs[key] ? C3 : C, textDecoration: doneIngs[key] ? "line-through" : "none", cursor: "pointer" }}>
                    <input type="checkbox" checked={!!doneIngs[key]} onChange={() => setDoneIngs((c) => ({ ...c, [key]: !c[key] }))} style={{ width: 20, height: 20, flexShrink: 0 }} />
                    {node}
                  </label>
                ))}
              </div>
              {factor !== 1 && <p style={{ fontSize: 12, color: C3, marginTop: 14 }}>Amounts scaled {factor.toFixed(2)}× for {servings} servings (from {baseServings}).</p>}
            </div>
          )}

          {/* all steps, visible at once */}
          <div>
            <span style={{ fontSize: 13, color: C3, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>Steps</span>
            <div style={{ marginTop: 6 }}>
              {steps.length > 0 ? steps.map((s, i) => (
                <StepRow key={i} n={i + 1} text={s} done={!!doneSteps[i]} onToggle={() => setDoneSteps((c) => ({ ...c, [i]: !c[i] }))} C={C} C2={C2} C3={C3} />
              )) : <p style={{ fontSize: 16, color: C3, marginTop: 12 }}>No steps listed for this recipe.</p>}
            </div>
          </div>
        </div>
      </div>

      {/* pinned Ask the Kitchen */}
      <div style={{ borderTop: "1px solid var(--border)", padding: "14px 18px", background: "var(--bg)" }}>
        <button onClick={onAskKitchen} style={{ width: "100%", maxWidth: 640, margin: "0 auto", display: "block", background: "var(--ai-panel)", border: "1px solid var(--ai-border)", color: "var(--brand-2)", padding: "13px", borderRadius: 11, fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
          <i className="ti ti-sparkles" style={{ fontSize: 16, verticalAlign: -2, marginRight: 7 }} aria-hidden />Stuck? Ask the Kitchen
        </button>
      </div>
    </div>
  );
}
