"use client";
import React from "react";

// A premium little medallion: a soft gradient disc in the badge's color, a
// crisp ring, the Tabler glyph centered, and a subtle glow. Looks designed and
// consistent everywhere — a big step up from raw keyboard emoji.
export function Badge({ icon, color, size = 22, onClick, title }: { icon: string; color: string; size?: number; onClick?: (e: any) => void; title?: string }) {
  const glyph = Math.round(size * 0.56);
  return (
    <span
      role={onClick ? "button" : undefined}
      title={title}
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        background: `radial-gradient(circle at 35% 30%, ${color}, ${color}cc 60%, ${color}99)`,
        border: `1.5px solid ${color}`,
        boxShadow: `0 0 0 1px var(--bg-raised), 0 1px 4px ${color}66`,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <i className={icon} style={{ fontSize: glyph, color: "#fff", lineHeight: 1, filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.35))" }} aria-hidden />
    </span>
  );
}

// Larger showcase version for the how-to-earn popup.
export function BadgeLarge({ icon, color, size = 72 }: { icon: string; color: string; size?: number }) {
  const glyph = Math.round(size * 0.5);
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: `radial-gradient(circle at 35% 30%, ${color}, ${color}bb 65%, ${color}88)`,
        border: `2.5px solid ${color}`,
        boxShadow: `0 0 0 4px ${color}22, 0 4px 18px ${color}66`,
      }}
    >
      <i className={icon} style={{ fontSize: glyph, color: "#fff", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))" }} aria-hidden />
    </span>
  );
}
