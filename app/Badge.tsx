"use client";
import React from "react";

// Real SVG badge art — a crafted medallion: faceted outer ring with metal
// sheen, a darker inset disc for depth, a thin accent rim in the badge color,
// and the glyph embossed in the center. Not "emoji in a circle" — actual shape,
// gradients, and depth so it reads as earned hardware.

type Tier = "bronze" | "silver" | "gold";

// Each badge maps to a metal tier (the frame) + an accent color (the rim/glyph).
const METAL: Record<Tier, { light: string; mid: string; dark: string }> = {
  bronze: { light: "#e8b98a", mid: "#b87333", dark: "#7a4a1e" },
  silver: { light: "#eef2f6", mid: "#b8c2cc", dark: "#7d8893" },
  gold:   { light: "#ffe9a8", mid: "#f1b94e", dark: "#b8841f" },
};

export function Badge({
  icon, color, tier = "silver", size = 24, onClick, title,
}: { icon: string; color: string; tier?: Tier; size?: number; onClick?: (e: any) => void; title?: string }) {
  const uid = React.useId().replace(/:/g, "");
  const m = METAL[tier];
  const r = size / 2;
  const glyph = Math.round(size * 0.46);

  return (
    <span
      role={onClick ? "button" : undefined}
      title={title}
      onClick={onClick}
      style={{ width: size, height: size, display: "inline-flex", flexShrink: 0, cursor: onClick ? "pointer" : "default", lineHeight: 0, position: "relative" }}
    >
      <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: "block" }}>
        <defs>
          <radialGradient id={`metal${uid}`} cx="38%" cy="30%" r="75%">
            <stop offset="0%" stopColor={m.light} />
            <stop offset="55%" stopColor={m.mid} />
            <stop offset="100%" stopColor={m.dark} />
          </radialGradient>
          <radialGradient id={`disc${uid}`} cx="40%" cy="35%" r="70%">
            <stop offset="0%" stopColor={color} stopOpacity="0.95" />
            <stop offset="100%" stopColor={color} stopOpacity="0.62" />
          </radialGradient>
          <linearGradient id={`sheen${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="45%" stopColor="#fff" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* faceted metal outer ring (decagon for a coin/medal facet feel) */}
        <polygon
          points="24,2 33,5 41,11 45,20 45,28 41,37 33,43 24,46 15,43 7,37 3,28 3,20 7,11 15,5"
          fill={`url(#metal${uid})`}
          stroke={m.dark}
          strokeWidth="0.8"
        />
        {/* accent rim in badge color */}
        <circle cx="24" cy="24" r="15.5" fill="none" stroke={color} strokeWidth="2" opacity="0.9" />
        {/* inset disc for depth */}
        <circle cx="24" cy="24" r="14" fill={`url(#disc${uid})`} stroke={m.dark} strokeWidth="0.6" />
        {/* top sheen highlight */}
        <ellipse cx="20" cy="16" rx="11" ry="6" fill={`url(#sheen${uid})`} />
      </svg>
      {/* glyph embossed on top (Tabler icon font, crisp) */}
      <i
        className={icon}
        style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: glyph, color: "#fff", filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.45))",
        }}
        aria-hidden
      />
    </span>
  );
}

export function BadgeLarge({ icon, color, tier = "silver", size = 84 }: { icon: string; color: string; tier?: Tier; size?: number }) {
  return (
    <span style={{ display: "inline-flex", filter: `drop-shadow(0 4px 14px ${color}66)` }}>
      <Badge icon={icon} color={color} tier={tier} size={size} />
    </span>
  );
}
