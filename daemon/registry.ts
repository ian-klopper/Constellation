/**
 * Persistent list of repos Constellation knows about. Backed by
 * `~/.constellation/repos.json`. The frontend's repo switcher reads
 * from here, so a freshly added repo with no Claude activity yet still
 * shows up — the lifecycle-derived view (which only sees repos that
 * have spawned agents) is exposed separately at /repos/active.
 *
 * Two ways a repo lands here: the user runs `constellation add` (which
 * POSTs /repos/register), or a hook event arrives with an unknown cwd
 * and `touch()` auto-registers it. Auto-registration keeps the
 * legacy "drop hooks in and go" UX working — the user doesn't have to
 * run a CLI command before the visualizer notices the repo.
 */
import path from "node:path";
import { promises as fs, realpathSync, existsSync } from "node:fs";
import { userReposPath, userDir } from "../lib/user-dirs";

export type RegisteredRepo = {
  path: string;
  name: string;
  addedAt: number;
  source: "manual" | "auto";
};

type RegistryFile = { repos: RegisteredRepo[] };

export class RepoRegistry {
  private repos = new Map<string, RegisteredRepo>();
  private writeQueue: Promise<void> = Promise.resolve();

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(userReposPath(), "utf8");
      const parsed = JSON.parse(raw) as Partial<RegistryFile>;
      if (Array.isArray(parsed.repos)) {
        for (const r of parsed.repos) {
          if (
            r &&
            typeof r.path === "string" &&
            typeof r.name === "string" &&
            typeof r.addedAt === "number"
          ) {
            this.repos.set(r.path, {
              path: r.path,
              name: r.name,
              addedAt: r.addedAt,
              source: r.source === "manual" || r.source === "auto" ? r.source : "manual",
            });
          }
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[daemon] registry load failed:", err);
      }
    }
  }

  /**
   * Stat-on-read filter: hide entries whose path no longer exists on
   * disk. Non-destructive — the entry stays in memory and on disk so a
   * recreated worktree (or a path that did not exist yet at register
   * time) reappears in the switcher automatically. The cost is a few
   * `existsSync` calls per /repos request.
   */
  list(): RegisteredRepo[] {
    return Array.from(this.repos.values())
      .filter((r) => existsSync(r.path))
      .sort((a, b) => a.addedAt - b.addedAt);
  }

  has(repoPath: string): boolean {
    return this.repos.has(repoPath);
  }

  /**
   * Idempotent insert. Returns true if a new entry was added.
   * Canonicalizes the path (realpath) so /tmp/foo and /private/tmp/foo
   * — same dir on macOS — don't end up as two separate entries.
   */
  register(repoPath: string, source: "manual" | "auto" = "manual"): boolean {
    const p = canonicalize(repoPath);
    if (!p) return false;
    if (this.repos.has(p)) return false;
    this.repos.set(p, {
      path: p,
      name: path.basename(p) || p,
      addedAt: Math.floor(Date.now() / 1000),
      source,
    });
    this.persist();
    return true;
  }

  /**
   * Auto-register on first event from an unknown cwd. Same as register()
   * but tagged source="auto". No-op if already registered.
   */
  touch(repoPath: string): void {
    const p = canonicalize(repoPath);
    if (!p) return;
    if (this.repos.has(p)) return;
    this.register(p, "auto");
  }

  unregister(repoPath: string): boolean {
    const p = canonicalize(repoPath);
    if (!p) return false;
    if (!this.repos.has(p)) return false;
    this.repos.delete(p);
    this.persist();
    return true;
  }

  // Single-flight serialized writes — chains onto the previous write so
  // two rapid register calls can't race the file.
  private persist(): void {
    const snapshot: RegistryFile = { repos: this.list() };
    this.writeQueue = this.writeQueue.then(() => writeRegistry(snapshot));
  }

  /** Wait for any pending writes — used during shutdown. */
  flush(): Promise<void> {
    return this.writeQueue;
  }
}

async function writeRegistry(snapshot: RegistryFile): Promise<void> {
  const target = userReposPath();
  await fs.mkdir(userDir(), { recursive: true });
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
  await fs.rename(tmp, target);
}

/**
 * Returns the realpath of an absolute path, or "" if the input is empty
 * or non-absolute. ENOENT (path doesn't exist on disk yet) falls back to
 * the input — the registry stores the user's stated path, not a
 * guarantee that the dir exists right now.
 */
function canonicalize(p: string): string {
  if (!p || typeof p !== "string") return "";
  if (!path.isAbsolute(p)) return "";
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
