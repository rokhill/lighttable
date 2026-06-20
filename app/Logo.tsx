"use client";
import React from "react";

// LightTable mark — a lightbulb whose glowing filament forms a table.
// LCAI brand colors (purple #5B4BFF → magenta #EE11FB) on the dark tile.
export function LogoIcon({ size = 34, rounded = true }: { size?: number; rounded?: boolean }) {
  const uid = React.useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block" }}>
      <defs>
        <linearGradient id={`lc${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5B4BFF" />
          <stop offset="100%" stopColor="#EE11FB" />
        </linearGradient>
        <radialGradient id={`gl${uid}`} cx="50%" cy="44%" r="42%">
          <stop offset="0%" stopColor="#EE11FB" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#EE11FB" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" rx={rounded ? 24 : 0} fill="#14152C" />
      <circle cx="50" cy="44" r="27" fill={`url(#gl${uid})`} />
      <path d="M50 14 a27 27 0 0 1 19 46 c-3 3 -5 7 -5 12 l-28 0 c0 -5 -2 -9 -5 -12 a27 27 0 0 1 19 -46 Z"
            fill="none" stroke={`url(#lc${uid})`} strokeWidth="4" />
      <g stroke={`url(#lc${uid})`} strokeWidth="4" strokeLinecap="round">
        <line x1="40" y1="79" x2="60" y2="79" />
        <line x1="42" y1="85" x2="58" y2="85" />
      </g>
      <path d="M37 53 L39 36 L61 36 L63 53" fill="none" stroke={`url(#lc${uid})`} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Wordmark for the header: the icon + "LightTable" in a clean weight.
export function Logo({ size = 21 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <LogoIcon size={size * 1.5} />
      <span style={{ fontSize: size, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.3px" }}>LightTable</span>
    </span>
  );
}
