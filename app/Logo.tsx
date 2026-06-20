"use client";
import React from "react";

// LightTable wordmark — the full name set in an elegant serif, "Light" in the
// foreground weight and "Table" in the gold gradient, with a subtle glowing
// accent. Designed to read as a refined cookbook brand, not an abstract icon.
export function Logo({ size = 22, dark }: { size?: number; dark?: boolean }) {
  const uid = React.useId().replace(/:/g, "");
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: size, fontWeight: 600, letterSpacing: "-0.3px", lineHeight: 1, whiteSpace: "nowrap" }}>
      <span style={{ color: "var(--text)" }}>Light</span>
      <span style={{
        background: "linear-gradient(135deg, #ffe3a0 0%, #ffd27a 50%, #f1962e 100%)",
        WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent",
      }}>Table</span>
      <span aria-hidden style={{
        marginLeft: size * 0.12, width: size * 0.16, height: size * 0.16, borderRadius: "50%",
        alignSelf: "flex-start", marginTop: size * 0.05,
        background: "radial-gradient(circle at 35% 35%, #ffe3a0, #f1962e)",
        boxShadow: "0 0 6px rgba(241,150,46,0.7)", display: "inline-block",
      }} />
    </span>
  );
}

// Square icon version (favicon / app tile): "Lt" ligature-style on a dark tile.
export function LogoIcon({ size = 34, rounded = true }: { size?: number; rounded?: boolean }) {
  const uid = React.useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block" }}>
      <defs>
        <linearGradient id={`li${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffe3a0" />
          <stop offset="50%" stopColor="#ffd27a" />
          <stop offset="100%" stopColor="#f1962e" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" rx={rounded ? 24 : 0} fill="#14152c" />
      <text x="50" y="70" fontFamily="Georgia, serif" fontSize="58" fontWeight="700" fill={`url(#li${uid})`} textAnchor="middle" letterSpacing="-3">Lt</text>
    </svg>
  );
}
