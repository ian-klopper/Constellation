/**
 * UI sizing, timing, and tint constants. Pulled out of the components so
 * they live in one searchable place — tweaking the agent-icon size, the
 * idle-debounce window, or the directory tints means editing this file
 * instead of grepping across components.
 */

export const TREEMAP = {
  LABEL_HEIGHT: 16,
  INNER_PAD: 3,
  // Minimum inner width/height before a directory bothers laying out children.
  MIN_RENDER: 8,
  // Pinned line-height for tile descriptions. Must match the leading-[N]
  // utility on the description <p> so floor(availH / DESCRIPTION_LINE_HEIGHT)
  // reflects actually-rendered lines and never clips mid-line.
  DESCRIPTION_LINE_HEIGHT: 14,
  // FileTile header (filename row): text-[11px] + py-1 + border-b. Conservative
  // value so the line-clamp math under-promises rather than over-promises.
  FILE_TILE_HEADER_HEIGHT: 24,
  // Total vertical padding on the description <p> (Tailwind py-1.5 = 6px each
  // side). Stored as the total — not per-side — so the line-clamp math reads
  // `h - HEADER - PADDING_Y` directly without a 2x multiplier foot-gun.
  DESCRIPTION_PADDING_Y: 12,
  // Tile <article> border total: 1px top + 1px bottom (border-box). The
  // squarify-supplied `h` is the full box; subtracting the borders gives
  // the actual content area the header + description must fit inside.
  ARTICLE_BORDER_Y: 2,
  // Top-level directory background tints. Subdirectories inherit their parent's.
  TINTS: {
    app: "bg-[#eef2f7]",
    components: "bg-[#e7eee2]",
    lib: "bg-[#f5f5f4]",
    supabase: "bg-[#f3edd9]",
    trigger: "bg-[#f0d9d9]",
  } as Record<string, string>,
} as const;

export const HOVER_PANEL = {
  WIDTH: 340,
  HARD_MAX_H: 600,
  // SSR fallback when window isn't available yet.
  FALLBACK_WIN_W: 1200,
  FALLBACK_WIN_H: 800,
  // Minimum panel height even in tight viewports.
  MIN_MAX_H: 80,
  CURSOR_OFFSET: 16,
  VIEWPORT_PADDING: 8,
  // If less than this many pixels below the cursor, prefer flipping above.
  MIN_BELOW_BEFORE_FLIP: 220,
} as const;

export const OVERLAY = {
  ICON_SIZE: 28,
  PARK_TOP: 12,
  PARK_RIGHT: 16,
  PARK_GAP: 6,
  STACK_OFFSET: 14,
} as const;

export const OVERLAY_TIMING = {
  IDLE_DEBOUNCE_MS: 600,
  REMOVE_FADE_MS: 400,
  // How often we re-render purely so the idle clock can re-evaluate
  // even when the poll didn't change the agent list.
  IDLE_TICK_MS: 300,
  POLL_INTERVAL_MS: 1000,
  // Initial fade-in window after an agent first appears.
  MOUNT_FADE_MS: 50,
  // Buffer added to the fade-out cleanup timer.
  REMOVE_FADE_BUFFER_MS: 50,
} as const;

export const OVERLAY_MOTION = {
  EASING: "cubic-bezier(0.22, 1, 0.36, 1)",
  TRANSFORM_MS: 450,
  OPACITY_MS: 350,
  BUBBLE_OPACITY_MS: 200,
} as const;
