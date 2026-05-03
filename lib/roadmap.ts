/**
 * Server-side reader for the roadmap sidecar at <root>/roadmap.json.
 * Validates the file against a zod schema that mirrors
 * roadmap.schema.json, so a hand-edit that drifts the shape produces
 * `null` (the visualizer hides the toggle) instead of crashing the
 * home page. Missing file ⇒ null. Malformed JSON ⇒ null. Schema
 * mismatch ⇒ null. The sidecar is optional by design.
 */
import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

const ID_PATTERN = /^[a-z0-9-]+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COMMIT_PATTERN = /^[a-f0-9]{7,40}$/;

const GoalItemSchema = z.object({
  id: z.string().regex(ID_PATTERN).min(1).max(60),
  title: z.string().min(1).max(200),
  status: z.enum(["queued", "in_progress", "blocked"]),
  notes: z.string().optional(),
  files: z.array(z.string()).optional(),
  plan: z.string().optional(),
});

const ShippedItemSchema = z.object({
  id: z.string().regex(ID_PATTERN).min(1).max(60),
  title: z.string().min(1).max(200),
  shipped_at: z.string().regex(ISO_DATE_PATTERN),
  commit: z.string().regex(COMMIT_PATTERN).optional(),
  notes: z.string().optional(),
});

const IdeaItemSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().optional(),
});

export const RoadmapSchema = z.object({
  $schema: z.string().optional(),
  right_now: z.string().max(280),
  short_term: z.array(GoalItemSchema),
  mid_term: z.array(GoalItemSchema),
  long_term: z.array(GoalItemSchema),
  recently_shipped: z.array(ShippedItemSchema),
  known_issues: z.array(IdeaItemSchema),
  open_questions: z.array(IdeaItemSchema),
  anti_goals: z.array(IdeaItemSchema),
  parked_ideas: z.array(IdeaItemSchema),
});

export type Roadmap = z.infer<typeof RoadmapSchema>;
export type GoalItem = z.infer<typeof GoalItemSchema>;
export type ShippedItem = z.infer<typeof ShippedItemSchema>;
export type IdeaItem = z.infer<typeof IdeaItemSchema>;

export async function readRoadmap(root: string): Promise<Roadmap | null> {
  const file = path.join(root, "roadmap.json");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = RoadmapSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
