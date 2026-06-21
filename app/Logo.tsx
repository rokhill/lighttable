"use client";
import React from "react";

export function LogoIcon({ size = 40, rounded = true }: { size?: number; rounded?: boolean }) {
  const uid = React.useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block" }}>
      <defs>
        <linearGradient id={`lc${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5B4BFF" /><stop offset="100%" stopColor="#EE11FB" />
        </linearGradient>
        <radialGradient id={`gl${uid}`} cx="50%" cy="38%" r="42%">
          <stop offset="0%" stopColor="#EE11FB" stopOpacity="0.32" /><stop offset="100%" stopColor="#EE11FB" stopOpacity="0" />
        </radialGradient>
      </defs>
      {rounded && <rect x="0" y="0" width="100" height="100" rx="24" fill="#14152C" />}
      <circle cx="50" cy="38" r="30" fill={`url(#gl${uid})`} />
      <path d="M50 6 a30 30 0 0 1 21 51 c-4 4 -6 8 -6 13 l-30 0 c0 -5 -2 -9 -6 -13 a30 30 0 0 1 21 -51 Z" fill="none" stroke={`url(#lc${uid})`} strokeWidth="4.5" />
      <g stroke={`url(#lc${uid})`} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M43 70 l14 0 l-1 18 l-12 0 Z" />
        <line x1="44" y1="77" x2="56" y2="77" /><line x1="45" y1="83" x2="55" y2="83" />
      </g>
      <path d="M30 30 L70 30 L70 36 L57 36 L57 50 L51 50 L51 36 L49 36 L49 50 L43 50 L43 36 L30 36 Z" fill={`url(#lc${uid})`} />
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <LogoIcon size={size * 1.9} />
      <span style={{
        fontSize: size * 1.25, fontWeight: 800, letterSpacing: "-0.5px",
        background: "linear-gradient(135deg, #5B4BFF 0%, #EE11FB 100%)",
        WebkitBackgroundClip: "text", backgroundClip: "text",
        WebkitTextFillColor: "transparent", color: "transparent",
      }}>LightTable</span>
    </span>
  );
}
