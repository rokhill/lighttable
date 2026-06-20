"use client";
import React from "react";

export function LogoIcon({ size = 34, rounded = true }: { size?: number; rounded?: boolean }) {
  const uid = React.useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block" }}>
      <defs>
        <linearGradient id={`lc${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5B4BFF" /><stop offset="100%" stopColor="#EE11FB" />
        </linearGradient>
        <radialGradient id={`gl${uid}`} cx="50%" cy="42%" r="40%">
          <stop offset="0%" stopColor="#EE11FB" stopOpacity="0.30" /><stop offset="100%" stopColor="#EE11FB" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="100" height="100" rx={rounded ? 24 : 0} fill="#14152C" />
      <circle cx="50" cy="42" r="25" fill={`url(#gl${uid})`} />
      <path d="M50 12 a25 25 0 0 1 18 43 c-3 3 -4 6 -4 10 l-28 0 c0 -4 -1 -7 -4 -10 a25 25 0 0 1 18 -43 Z" fill="none" stroke={`url(#lc${uid})`} strokeWidth="4" />
      <path d="M40 65 l20 0 l-2 12 l-16 0 Z" fill="none" stroke={`url(#lc${uid})`} strokeWidth="3.5" strokeLinejoin="round" />
      <g stroke={`url(#lc${uid})`} strokeWidth="3" strokeLinecap="round">
        <line x1="41" y1="69" x2="59" y2="69" /><line x1="42" y1="73" x2="58" y2="73" />
      </g>
      <path d="M36 50 L38 34 L62 34 L64 50" fill="none" stroke={`url(#lc${uid})`} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ size = 21 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
      <LogoIcon size={size * 1.6} />
      <span style={{ fontSize: size, fontWeight: 700, letterSpacing: "-0.4px" }}>
        <span style={{ color: "var(--text)", fontWeight: 400 }}>Light</span>
        <span style={{ color: "var(--text)", fontWeight: 800 }}>Table</span>
      </span>
    </span>
  );
}
