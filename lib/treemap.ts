/**
 * The math that decides how big each rectangle on the map should be and
 * where it sits. You hand it a list of sizes and a box to fill, and it
 * slices the box into smaller boxes whose areas match those sizes — picking
 * cuts that keep each piece roughly square instead of long and skinny.
 * Called once per folder.
 */

export type TreemapInput = { value: number };
export type Rect = { x: number; y: number; w: number; h: number };

export function squarify(items: TreemapInput[], rect: Rect): Rect[] {
  if (items.length === 0) return [];
  const totalValue = items.reduce((s, it) => s + it.value, 0);
  if (totalValue <= 0 || rect.w <= 0 || rect.h <= 0) {
    return items.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
  }

  const scale = (rect.w * rect.h) / totalValue;
  const areas = items.map((it) => it.value * scale);

  const result: Rect[] = new Array(items.length);
  let remaining = { ...rect };
  let i = 0;

  while (i < areas.length) {
    const shorter = Math.min(remaining.w, remaining.h);
    const rowStart = i;
    let sum = 0;
    let max = 0;
    let min = Infinity;
    let count = 0;

    while (i < areas.length) {
      const a = areas[i];
      const nextSum = sum + a;
      const nextMax = Math.max(max, a);
      const nextMin = Math.min(min, a);
      if (count === 0) {
        sum = nextSum;
        max = nextMax;
        min = nextMin;
        count = 1;
        i++;
        continue;
      }
      const current = worst(shorter, sum, max, min);
      const candidate = worst(shorter, nextSum, nextMax, nextMin);
      if (candidate <= current) {
        sum = nextSum;
        max = nextMax;
        min = nextMin;
        count++;
        i++;
      } else {
        break;
      }
    }

    // Lay the committed row across the shorter side.
    if (remaining.w <= remaining.h) {
      const stripH = sum / remaining.w;
      let x = remaining.x;
      const y = remaining.y;
      for (let k = rowStart; k < i; k++) {
        const w = areas[k] / stripH;
        result[k] = { x, y, w, h: stripH };
        x += w;
      }
      remaining = {
        x: remaining.x,
        y: remaining.y + stripH,
        w: remaining.w,
        h: remaining.h - stripH,
      };
    } else {
      const stripW = sum / remaining.h;
      const x = remaining.x;
      let y = remaining.y;
      for (let k = rowStart; k < i; k++) {
        const h = areas[k] / stripW;
        result[k] = { x, y, w: stripW, h };
        y += h;
      }
      remaining = {
        x: remaining.x + stripW,
        y: remaining.y,
        w: remaining.w - stripW,
        h: remaining.h,
      };
    }
  }

  return result;
}

function worst(shorter: number, sum: number, max: number, min: number): number {
  const s2 = sum * sum;
  const w2 = shorter * shorter;
  return Math.max((w2 * max) / s2, s2 / (w2 * min));
}
