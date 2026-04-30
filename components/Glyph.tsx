import type { SymbolKind } from "@/lib/types";

const SIZE = 12;
const STROKE = 1.25;

export function Glyph({ kind }: { kind: SymbolKind }) {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 12 12"
      className="shrink-0 text-zinc-700"
      aria-hidden
    >
      <Shape kind={kind} />
    </svg>
  );
}

function Shape({ kind }: { kind: SymbolKind }) {
  switch (kind) {
    case "component":
      return (
        <circle
          cx="6"
          cy="6"
          r="3.75"
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
        />
      );
    case "route":
      return (
        <rect
          x="2.5"
          y="2.5"
          width="7"
          height="7"
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          transform="rotate(45 6 6)"
        />
      );
    case "action":
      return (
        <rect
          x="2.5"
          y="2.5"
          width="7"
          height="7"
          fill="currentColor"
          transform="rotate(45 6 6)"
        />
      );
    case "hook":
    case "type":
      return (
        <rect
          x="2.5"
          y="2.5"
          width="7"
          height="7"
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
        />
      );
    case "function":
      return (
        <rect x="2.5" y="2.5" width="7" height="7" fill="currentColor" />
      );
    case "const":
      return <circle cx="6" cy="6" r="2" fill="currentColor" />;
  }
}
