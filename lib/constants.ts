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
} as const;

// Live "thought bubble" anchored above each agent icon on the map. MAX_WIDTH
// caps horizontal sprawl so a long thought never spans the canvas; HEIGHT is
// the assumed rendered height used for stack-offset math when N agents share a
// tile (real height is line-clamped at LINE_CLAMP). GAP is the vertical space
// between stacked bubbles.
export const BUBBLE = {
  MAX_WIDTH: 220,
  HEIGHT: 36,
  GAP: 4,
  LINE_CLAMP: 2,
} as const;

// Compact top-right indicator for agents with no tile to anchor to.
// Hidden when empty. Detail comes from hover/focus popover.
// AVATAR_SIZE is deliberately small so adding the dock does not grow
// the header (text-[11px] py-3 fits 20px avatars within existing line-height).
export const DOCK = {
  AVATAR_SIZE: 20,
  AVATAR_OVERLAP: 8,
  MAX_VISIBLE: 5,
  POPOVER_WIDTH: 280,
  POPOVER_DELAY_MS: 200,
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
  // After this many seconds of silence, an agent in the activity rail
  // dims and shows a "silent Xs" hint. Half the daemon's reap window
  // (config.staleAgentSeconds, default 60) so the warning is visible
  // before the row actually disappears.
  STALE_VISUAL_THRESHOLD_S: 30,
} as const;

export const OVERLAY_MOTION = {
  EASING: "cubic-bezier(0.22, 1, 0.36, 1)",
  TRANSFORM_MS: 450,
  OPACITY_MS: 350,
} as const;

// Universal tile-activity fade. Every tool touch from every agent writes a
// timestamped pathHistory entry; useTileActivity decays each entry over
// FADE_MS using a 200ms heartbeat. OPACITY_QUANTUM rounds computed opacity
// to 5% steps so most ticks produce identical values and TreemapNode's
// React.memo stays stable.
export const TILE_TOUCH = {
  FADE_MS: 6000,
  TICK_MS: 200,
  OPACITY_QUANTUM: 0.05,
} as const;

// Per-agent file-trail overlay. PATH_HISTORY_MAX is the server-side cap on
// how many visited paths each agent carries in its snapshot — it's mirrored
// in daemon/lifecycle.ts so the wire payload can't blow up over a long
// session. FOSSIL_LIFETIME_MS is the post-stop window during which a
// finished agent's trail keeps drawing while fading out.
export const CONSTELLATION = {
  STROKE_WIDTH: 1.5,
  ALIVE_OPACITY: 0.85,
  FOSSIL_LIFETIME_MS: 30_000,
  PATH_HISTORY_MAX: 50,
  // How long an individual segment stays visible after its ts (epoch seconds).
  // Segments fade from full bright to zero over this window so the tail of a
  // long trail gradually disappears while the head stays vivid.
  SEGMENT_LIFETIME_MS: 60_000,
  // Duration of the stroke-dashoffset draw-in tween when a new segment first
  // becomes visible. Matches OVERLAY_MOTION.EASING for a consistent feel.
  SEGMENT_DRAW_IN_MS: 350,
  // Quadratic-bezier corner radius (CSS px) for the orthogonal routing elbow.
  // Below 2× this value on either axis, segments degenerate to straight lines.
  ROUTING_CORNER_RADIUS: 6,
} as const;

// Zoom + LOD constants for the cursor-anchored scroll-zoom + drag-pan
// gesture surface owned by Visualizer. ZOOM.MIN is always 1 in the layout
// space (canvas exactly fills the viewport at zoom=1), so the floor doesn't
// need re-derivation on resize — only pan does.
//
// MAX is currently pinned at 1, which fully disables scale-zoom: the
// visualization always exactly fills the viewport, never overflows, never
// clips a tile against the viewport edge. The user controls density via
// the DetailSlider (level 1–60) instead. The zoom infrastructure stays
// in place for a future drill-down zoom mode; flipping MAX back to 8
// would re-enable scale-zoom without further surgery.
export const ZOOM = {
  MIN: 1,
  MAX: 1,
  // Wheel-event delta multiplier for the magnitude-aware zoom factor:
  // factor = exp(-deltaY * SENSITIVITY), then clamped to [0.5, 2] per event.
  // 0.005 makes mouse-wheel detents (deltaY ~100) feel like ~1.65× per
  // click and trackpad ticks (deltaY ~5) feel like ~1.025× — both feel
  // right without a modifier semantic.
  SENSITIVITY: 0.005,
  // committedZoom (the React state TreemapNode's LOD gate reads) updates
  // only when the live zoom diverges from it by ≥ this fraction. Keeps
  // TreemapNode reconciliation rare during continuous gestures — a wheel
  // sweep from 1 to 8 produces ~40 commits, not ~600 wheel events.
  LOD_COMMIT_QUANTUM: 0.05,
} as const;

// Shared between PinController's empty-space-click guard and Visualizer's
// click-vs-drag classifier. Lives here so both consumers agree on the
// threshold without one of them silently drifting.
export const POINTER_MOVE_THRESHOLD = 4;

// Scan-time gates. The principle: a 14 GB build cache should still appear
// on the map (so the user can see it exists) but must not be loaded into
// memory. Anything above these caps becomes a placeholder tile instead.
//
// MAX_FILE_BYTES catches single huge files (minified bundles, JSON dumps,
// generated TS). MAX_DIR_BYTES / MAX_DIR_FILES catch directories whose
// children are individually small but collectively explosive
// (.trigger/.turbo/.cache/etc. across ecosystems). OVERSIZE_DISPLAY_LINES
// caps the synthetic line count we hand placeholders so they don't dominate.
export const SCAN_LIMITS = {
  MAX_FILE_BYTES: 1024 * 1024,
  MAX_DIR_BYTES: 100 * 1024 * 1024,
  MAX_DIR_FILES: 5000,
  OVERSIZE_DISPLAY_LINES: 1000,
} as const;
