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
import { promises as fs } from "node:fs";
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

  list(): RegisteredRepo[] {
    return Array.from(this.repos.values()).sort((a, b) => a.addedAt - b.addedAt);
  }

  has(repoPath: string): boolean {
    return this.repos.has(repoPath);
  }

  /**
   * Idempotent insert. Returns true if a new entry was added.
   */
  register(repoPath: string, source: "manual" | "auto" = "manual"): boolean {
    if (!path.isAbsolute(repoPath)) return false;
    if (this.repos.has(repoPath)) return false;
    this.repos.set(repoPath, {
      path: repoPath,
      name: path.basename(repoPath) || repoPath,
      addedAt: Math.floor(Date.now() / 1000),
      source,
    });
    this.persist();
    return true;
  }

  /**
   * Auto-register on first event from an unknown cwd. Same as register()
   * but tagged source="auto" so the UI can treat it differently if it
   * wants. No-op if already registered.
   */
  touch(repoPath: string): void {
    if (!repoPath || !path.isAbsolute(repoPath)) return;
    if (this.repos.has(repoPath)) return;
    this.register(repoPath, "auto");
  }

  unregister(repoPath: string): boolean {
    if (!this.repos.has(repoPath)) return false;
    this.repos.delete(repoPath);
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
