"use client";
import React from "react";

// LightTable mark — "Plate Glow": concentric rings radiating from a glowing
// center, like light rippling across a set table / an overhead place setting.
// Scales crisply from favicon to header. Uses the brand gold gradient.
export function Logo({ size = 32, rounded = true }: { size?: number; rounded?: boolean }) {
  const uid = React.useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block" }}>
      <defs>
        <radialGradient id={`lg${uid}`} cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor="#ffe3a0" />
          <stop offset="55%" stopColor="#ffd27a" />
          <stop offset="100%" stopColor="#f1962e" />
        </radialGradient>
      </defs>
      {/* dark base */}
      <rect x="0" y="0" width="100" height="100" rx={rounded ? 24 : 0} fill="#14152c" />
      {/* radiating rings */}
      <circle cx="50" cy="50" r="32" fill="none" stroke={`url(#lg${uid})`} strokeWidth="3.5" opacity="0.95" />
      <circle cx="50" cy="50" r="22" fill="none" stroke={`url(#lg${uid})`} strokeWidth="2.5" opacity="0.6" />
      {/* glowing center */}
      <circle cx="50" cy="50" r="8" fill={`url(#lg${uid})`} />
      {/* light points (N/S/E/W) */}
      <g stroke={`url(#lg${uid})`} strokeWidth="3.5" strokeLinecap="round" opacity="0.9">
        <line x1="50" y1="8" x2="50" y2="16" />
        <line x1="50" y1="84" x2="50" y2="92" />
        <line x1="8" y1="50" x2="16" y2="50" />
        <line x1="84" y1="50" x2="92" y2="50" />
      </g>
    </svg>
  );
}
