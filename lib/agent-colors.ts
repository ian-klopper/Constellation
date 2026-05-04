/**
 * Single source of truth for the agent color palette. Replaces the
 * duplicated inline color logic in AgentIcon.tsx (Tailwind bg classes)
 * and ConstellationOverlay.tsx (raw rgb strings).
 *
 * Sky = main agent, amber = background subagent, emerald = foreground
 * subagent. All three consumers — the icon, the rail row, and the SVG
 * trail — derive their color from this one lookup.
 */

export type AgentColors = {
  /** Tailwind bg-* class for the filled circle. */
  ringClass: string;
  /** Tailwind bg-* class for the animated ping ring. */
  pingClass: string;
  /** Raw CSS rgb() string for SVG stroke / JS box-shadow. */
  fillRgb: string;
};

export function agentColor(a: {
  id: string;
  kind?: string;
}): AgentColors {
  const isMain = a.id === "main";
  const isBg = a.kind === "background";

  if (isMain) {
    return {
      ringClass: "bg-sky-500",
      pingClass: "bg-sky-400",
      fillRgb: "rgb(14 165 233)", // sky-500
    };
  }
  if (isBg) {
    return {
      ringClass: "bg-amber-500",
      pingClass: "bg-amber-400",
      fillRgb: "rgb(245 158 11)", // amber-500
    };
  }
  return {
    ringClass: "bg-emerald-500",
    pingClass: "bg-emerald-400",
    fillRgb: "rgb(16 185 129)", // emerald-500
  };
}
