/**
 * Orthogonal ("road") routing for agent trail segments. Rather than
 * connecting two tile centers with a straight diagonal, we route along
 * the longer axis first, then turn 90°, with a small rounded elbow.
 *
 * Algorithm — longer axis first:
 *   Pick the axis with the greater absolute distance as the first leg.
 *   This puts the bend closer to the destination, which reads as more
 *   direct than centering the elbow in the middle. The elbow is drawn
 *   as a quadratic bezier (Q) through the corner point with a radius-
 *   clipped tangent entry/exit, giving smooth rounded corners.
 *
 *   The corner radius is capped adaptively: `r = min(cornerRadius,
 *   |dx|/3, |dy|/3)`. This guarantees the arc always fits both legs
 *   (consumes at most 1/3 of each), so sibling tiles in the same row
 *   (where dy ≈ 0) still get a tiny rounded arc rather than falling
 *   through to a straight diagonal. Only when the effective radius rounds
 *   to zero (dx or dy truly ≈ 0 — i.e. co-linear endpoints) do we
 *   degenerate to a straight line.
 *
 * Coordinate system: browser CSS pixels (same space as
 * getBoundingClientRect), so the returned path string plugs directly
 * into an SVG with no viewBox (fixed + inset-0 sizing).
 */

/** Route a single segment between two tile centers, returning SVG path data. */
export function routeSegment(
  a: { cx: number; cy: number },
  b: { cx: number; cy: number },
  opts: { cornerRadius: number },
): string {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;

  // Cap the corner radius so the L always fits both legs. The corner
  // consumes at most 1/3 of each leg, leaving 2/3 for the straight
  // approach/exit. Only collapse to a straight line when the effective
  // radius rounds to zero (dx or dy ≈ 0 — the endpoints are co-linear).
  const r = Math.min(opts.cornerRadius, Math.abs(dx) / 3, Math.abs(dy) / 3);
  if (r < 1) {
    return `M${a.cx.toFixed(2)} ${a.cy.toFixed(2)} L${b.cx.toFixed(2)} ${b.cy.toFixed(2)}`;
  }

  const sx = Math.sign(dx) || 1; // horizontal direction (+1 right, -1 left)
  const sy = Math.sign(dy) || 1; // vertical direction   (+1 down,  -1 up)

  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal first, then vertical. Elbow corner at (b.cx, a.cy).
    // Approach along X until r px before corner, arc through Q, descend.
    const ex = b.cx - r * sx; // X of arc entry point
    const ey1 = a.cy;          // Y on the horizontal leg (constant)
    const ey2 = a.cy + r * sy; // Y of arc exit point
    return (
      `M${a.cx.toFixed(2)} ${a.cy.toFixed(2)} ` +
      `L${ex.toFixed(2)} ${ey1.toFixed(2)} ` +
      `Q${b.cx.toFixed(2)} ${ey1.toFixed(2)},${b.cx.toFixed(2)} ${ey2.toFixed(2)} ` +
      `L${b.cx.toFixed(2)} ${b.cy.toFixed(2)}`
    );
  } else {
    // Vertical first, then horizontal. Elbow corner at (a.cx, b.cy).
    const ex1 = a.cx;          // X on the vertical leg (constant)
    const ey = b.cy - r * sy; // Y of arc entry point
    const ex2 = a.cx + r * sx; // X of arc exit point
    return (
      `M${a.cx.toFixed(2)} ${a.cy.toFixed(2)} ` +
      `L${ex1.toFixed(2)} ${ey.toFixed(2)} ` +
      `Q${ex1.toFixed(2)} ${b.cy.toFixed(2)},${ex2.toFixed(2)} ${b.cy.toFixed(2)} ` +
      `L${b.cx.toFixed(2)} ${b.cy.toFixed(2)}`
    );
  }
}
