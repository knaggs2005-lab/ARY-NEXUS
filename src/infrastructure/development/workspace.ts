import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  lstat,
  realpath,
  symlink,
  unlink,
  rmdir,
  readdir,
} from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import type {
  DevelopmentExecutor,
  DevelopmentRun,
  WorkspaceReceipt,
  ValidationReceipt,
  CommandName,
} from "../../domain/self-development";
import {
  forbiddenPath,
  secretPath,
  sourcePath,
  protectedPath,
  WorkspacePolicyError,
} from "../../domain/self-development";
import { documentationPath } from "../../domain/development-autonomy";
import { AppError } from "../../domain/validation";
import {
  runSandboxed,
  commandTimeoutMs,
  type SandboxedCommand,
} from "./runner";

const exec = promisify(execFile);
export const contentHash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
/** Trusted server-configured root only. Filesystem receipt journal reconciles effects; canonical authority stays in actions. */
export class GitDevelopmentWorkspace implements DevelopmentExecutor {
  constructor(
    private repository: string,
    private root: string,
    private dependencies: string,
    private runner: SandboxedCommand = runSandboxed,
  ) {}
  private async init() {
    if (!this.root.startsWith("/") || !this.repository.startsWith("/"))
      throw new AppError("Absolute trusted development roots required", 503);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    this.root = await realpath(this.root);
    this.repository = await realpath(this.repository);
    if (
      this.root === this.repository ||
      this.root.startsWith(this.repository + "/")
    )
      throw new AppError(
        "Workspace root must be outside the live repository",
        403,
      );
  }
  private directory(run: DevelopmentRun) {
    if (!/^[a-f0-9-]{36}$/.test(run.id))
      throw new AppError("Invalid run identity");
    return join(this.root, run.id);
  }
  private git(cwd: string, args: string[]) {
    const allowed = [
      "rev-parse",
      "symbolic-ref",
      "ls-files",
      "diff",
      "show",
      "status",
      "worktree",
    ];
    if (
      !allowed.includes(args[0]) ||
      (args[0] === "worktree" && !["add", "remove"].includes(args[1])) ||
      args.includes("--force") ||
      args.includes("-f")
    )
      throw new AppError("Git operation not allowlisted", 403);
    if (cwd !== this.repository && !cwd.startsWith(this.root + "/"))
      throw new AppError("Git cwd escape", 403);
    return exec(
      "/usr/bin/git",
      [
        "--no-pager",
        "--literal-pathspecs",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.attributesFile=/dev/null",
        ...args,
      ],
      {
        cwd,
        shell: false,
        timeout: 15000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          NODE_ENV: "production",
          PATH: "/usr/bin:/bin",
          HOME: this.root,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
        },
      },
    )
      .then((r) => r.stdout)
      .catch(() => {
        // execFile errors can embed source output; never publish raw stderr/stdout.
        throw new AppError(
          `Bounded Git ${args[0]} failed; workspace retained for inspection`,
          409,
        );
      });
  }
  private async store(path: string, value: unknown) {
    const tmp = path + ".tmp";
    await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
    await rename(tmp, path);
  }
  private async reservation(run: DevelopmentRun) {
    await this.init();
    const lock = join(this.root, "repository.lock");
    try {
      await mkdir(lock, { mode: 0o700 });
      await this.store(join(lock, "owner.json"), {
        id: run.id,
        owner: run.owner,
        repository: this.repository,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const owner = JSON.parse(
        await readFile(join(lock, "owner.json"), "utf8"),
      );
      if (
        owner.id !== run.id ||
        owner.owner !== run.owner ||
        owner.repository !== this.repository
      )
        throw new AppError(
          "Repository reserved by another development run; blocked until owner releases it",
          409,
        );
    }
  }
  private async operation<T>(
    run: DevelopmentRun,
    name: string,
    input: string,
    work: () => Promise<T>,
  ): Promise<T> {
    await this.reservation(run);
    const dir = this.directory(run);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if ((await realpath(dir)) !== dir)
      throw new WorkspacePolicyError("Workspace directory alias");
    const receipt = join(dir, `${name}.json`);
    try {
      const old = JSON.parse(await readFile(receipt, "utf8"));
      if (old.input !== input)
        throw new AppError("Operation belongs to different scope", 409);
      if (old.status === "done") return old.result as T;
      throw new AppError(
        "Uncertain development operation; inspect receipt/workspace before any retry",
        409,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    // Exclusive operation claim survives a process crash. Never steal an uncertain claim.
    await writeFile(receipt, JSON.stringify({ status: "started", input }), {
      flag: "wx",
      mode: 0o600,
    });
    const result = await work();
    await this.store(receipt, { status: "done", input, result });
    return result;
  }
  private worktree(run: DevelopmentRun) {
    return join(this.directory(run), "worktree");
  }
  private async ownership(run: DevelopmentRun) {
    const tree = this.worktree(run);
    if (
      (await realpath(this.directory(run))) !== this.directory(run) ||
      (await realpath(tree)) !== tree
    )
      throw new WorkspacePolicyError("Workspace symlink escape");
    const owner = JSON.parse(
      await readFile(join(this.directory(run), "ownership.json"), "utf8"),
    );
    if (
      owner.run !== run.id ||
      owner.owner !== run.owner ||
      owner.repository !== this.repository ||
      owner.scope !== run.plan_hash
    )
      throw new WorkspacePolicyError("Workspace ownership or scope changed");
    if (
      (await this.git(tree, ["symbolic-ref", "--short", "HEAD"])).trim() !==
        `ary/dev/${run.id}` ||
      (await realpath(
        (await this.git(tree, ["rev-parse", "--show-toplevel"])).trim(),
      )) !== tree
    )
      throw new WorkspacePolicyError(
        "Not the owned development branch/worktree; main is forbidden",
      );
    const common = (
      await this.git(tree, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ])
    ).trim();
    if ((await realpath(common)) !== owner.common)
      throw new WorkspacePolicyError("Foreign Git worktree");
  }
  private async safePath(tree: string, path: string) {
    sourcePath.parse(path);
    let current = tree;
    for (const segment of path.split("/")) {
      current = join(current, segment);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1))
          throw new WorkspacePolicyError("Symlink or hardlink escape");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
  }
  private async changed(run: DevelopmentRun) {
    const tree = this.worktree(run);
    const names = [
      ...new Set(
        (
          (await this.git(tree, [
            "diff",
            "--name-only",
            "-z",
            run.plan!.base_commit,
            "--",
          ])) + (await this.git(tree, ["ls-files", "--others", "-z"]))
        )
          .split("\0")
          .filter(Boolean),
      ),
    ].sort();
    for (const path of names) {
      await this.safePath(tree, path);
      if (forbiddenPath(path))
        throw new WorkspacePolicyError(
          "Dependency, secret or protected authority change requires separate elevated human review",
        );
      if (protectedPath(path) && !run.protected_approval)
        throw new WorkspacePolicyError(
          "Protected/migration change requires elevated approval",
        );
      if (!run.plan!.paths.includes(path))
        throw new WorkspacePolicyError("Changed file outside approved scope");
    }
    return names;
  }
  private async files(run: DevelopmentRun, includePatch = true) {
    await this.ownership(run);
    await this.changed(run);
    const tree = this.worktree(run);
    const tracked = (await this.git(tree, ["ls-files", "-z"]))
      .split("\0")
      .filter(Boolean);
    if (
      (await this.git(tree, ["rev-parse", "HEAD"])).trim() !==
      run.plan!.base_commit
    )
      throw new WorkspacePolicyError("Worktree base changed");
    const untracked = (await this.git(tree, ["ls-files", "--others", "-z"]))
      .split("\0")
      .filter(Boolean);
    if (
      untracked.some((p) => !run.patch?.value.changes.some((c) => c.path === p))
    )
      throw new WorkspacePolicyError("Unexpected untracked worktree file");
    const names = [
      ...new Set([
        ...tracked,
        ...(includePatch
          ? (run.patch?.value.changes.map((c) => c.path) ?? [])
          : []),
      ]),
    ].sort();
    const manifest = [];
    let totalBytes = 0;
    for (const p of names) {
      sourcePath.parse(p);
      if (p !== ".env.example" && secretPath(p))
        throw new AppError(
          "Tracked secrets cannot enter development snapshot",
          403,
        );
      await this.safePath(tree, p);
      let stat;
      try {
        stat = await lstat(join(tree, p));
      } catch (e) {
        if (
          (e as NodeJS.ErrnoException).code === "ENOENT" &&
          run.phase === "WORKSPACE" &&
          run.patch?.value.changes.some(
            (c) => c.path === p && c.before === null,
          )
        )
          continue;
        throw e;
      }
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > 32 * 1024 * 1024
      )
        throw new AppError("Unsupported source file or link", 403);
      totalBytes += stat.size;
      if (totalBytes > 128 * 1024 * 1024)
        throw new AppError("Repository snapshot exceeds budget", 413);
      manifest.push([p, contentHash(await readFile(join(tree, p)))]);
    }
    return { names, candidate: contentHash(JSON.stringify(manifest)) };
  }
  async isolate(run: DevelopmentRun, operation: string, signal?: AbortSignal) {
    return this.operation<WorkspaceReceipt>(
      run,
      "workspace",
      run.plan_hash!,
      async () => {
        signal?.throwIfAborted();
        const base = run.plan!.base_commit;
        if (
          (
            await this.git(this.repository, ["rev-parse", `${base}^{commit}`])
          ).trim() !== base
        )
          throw new AppError("Base is not an existing commit", 409);
        const branch = `ary/dev/${run.id}`,
          tree = this.worktree(run);
        await this.git(this.repository, [
          "worktree",
          "add",
          "-b",
          branch,
          tree,
          base,
        ]);
        await this.store(join(this.directory(run), "ownership.json"), {
          run: run.id,
          owner: run.owner,
          repository: this.repository,
          scope: run.plan_hash,
          common: await realpath(
            (
              await this.git(this.repository, [
                "rev-parse",
                "--path-format=absolute",
                "--git-common-dir",
              ])
            ).trim(),
          ),
          action: operation,
          created_at: new Date().toISOString(),
        });
        const files = await this.files(run);
        return { branch, base, candidate: files.candidate };
      },
    );
  }
  async apply(run: DevelopmentRun, operation: string, signal?: AbortSignal) {
    return this.operation<WorkspaceReceipt>(
      run,
      "implementation",
      run.patch!.hash,
      async () => {
        if (
          (await this.files(run, false)).candidate !== run.workspace!.candidate
        )
          throw new WorkspacePolicyError(
            "Worktree changed before implementation",
          );
        const tree = this.worktree(run);
        const tracked = (await this.files(run, false)).names;
        for (const change of run.patch!.value.changes) {
          signal?.throwIfAborted();
          sourcePath.parse(change.path);
          if (
            forbiddenPath(change.path) ||
            !run.plan!.paths.includes(change.path)
          )
            throw new AppError("Protected or out-of-scope patch", 403);
          if (protectedPath(change.path) && !run.protected_approval)
            throw new WorkspacePolicyError("Elevated approval required");
          await this.safePath(tree, change.path);
          const target = resolve(tree, change.path);
          if (!target.startsWith(tree + "/"))
            throw new AppError("Path escape", 403);
          let before: string | null = null;
          try {
            const stat = await lstat(target);
            if (!stat.isFile() || stat.nlink !== 1)
              throw new AppError("Invalid patch target", 403);
            before = contentHash(await readFile(target));
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
          if (before !== null && !tracked.includes(change.path))
            throw new AppError("Path must match tracked filename exactly", 403);
          if (before !== change.before)
            throw new AppError("Patch preimage changed", 409);
          if (change.path.startsWith("tests/") && before !== null)
            throw new AppError(
              "Existing tests are immutable; add a regression test instead",
              403,
            );
          const parent = dirname(target);
          await mkdir(parent, { recursive: true });
          if (
            !(await realpath(parent)).startsWith(tree + "/") &&
            (await realpath(parent)) !== tree
          )
            throw new AppError("Symlink escape", 403);
        }
        for (const change of run.patch!.value.changes) {
          signal?.throwIfAborted();
          await this.safePath(tree, change.path);
          const target = join(tree, change.path);
          await writeFile(target + ".ary-part", change.content, {
            mode: 0o600,
            flag: "wx",
          });
          await rename(target + ".ary-part", target);
        }
        const files = await this.files(run);
        return { ...run.workspace!, candidate: files.candidate };
      },
    );
  }
  async inspect(run: DevelopmentRun) {
    await this.init();
    const { candidate } = await this.files(run),
      tree = this.worktree(run);
    let diff = await this.git(tree, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      run.plan!.base_commit,
      "--",
    ]);
    for (const change of run.patch?.value.changes ?? [])
      if (change.before === null && run.phase !== "WORKSPACE")
        diff +=
          `\n+++ ${change.path}\n` +
          (await readFile(join(tree, change.path), "utf8"))
            .split("\n")
            .map((l) => "+" + l)
            .join("\n");
    if (diff.length > 96000)
      throw new WorkspacePolicyError(
        "Diff exceeds 96000-character review budget; owner scope revision required",
      );
    if (
      /sk-[A-Za-z0-9_-]{10,}|-----BEGIN .*PRIVATE KEY-----|(?:api[_-]?key|password|token|secret)\s*[:=]\s*[\"\'][^\"\']{8,}/i.test(
        diff,
      )
    )
      throw new WorkspacePolicyError(
        "Potential secret in diff; human inspection required",
      );
    return {
      candidate,
      diff,
      files: await this.changed(run),
    };
  }
  /** Publish a documentation-only object/ref, never a checkout, main, remote or deployment. */
  async publishLocal(run: DevelopmentRun, signal?: AbortSignal) {
    return this.operation(run, "local-release", run.release!.hash, async () => {
      const snapshot = await this.inspect(run);
      if (
        !snapshot.files.length ||
        snapshot.files.some((p) => !documentationPath(p)) ||
        snapshot.candidate !== run.review?.candidate
      )
        throw new WorkspacePolicyError(
          "Local release candidate is not qualified",
        );
      const tree = this.worktree(run),
        base = run.workspace!.base;
      const ref = `refs/ary/releases/${run.id}`;
      const git = async (args: string[]) => {
        signal?.throwIfAborted();
        try {
          const result = await exec(
            "/usr/bin/git",
            [
              "--literal-pathspecs",
              "-c",
              "core.hooksPath=/dev/null",
              "-c",
              "core.fsmonitor=false",
              ...args,
            ],
            {
              cwd: tree,
              shell: false,
              timeout: 15000,
              maxBuffer: 1024 * 1024,
              signal,
              env: {
                PATH: "/usr/bin:/bin",
                HOME: this.root,
                GIT_CONFIG_NOSYSTEM: "1",
                GIT_CONFIG_GLOBAL: "/dev/null",
                GIT_INDEX_FILE: join(this.directory(run), "release.index"),
                NODE_ENV: "production",
                GIT_AUTHOR_NAME: "Ary Release",
                GIT_AUTHOR_EMAIL: "ary@localhost",
                GIT_COMMITTER_NAME: "Ary Release",
                GIT_COMMITTER_EMAIL: "ary@localhost",
              },
            },
          );
          return result.stdout.trim();
        } catch {
          throw new AppError(
            "Local release Git operation failed; reconcile receipt before retry",
            409,
          );
        }
      };
      await git(["read-tree", base]);
      for (const path of snapshot.files) {
        await this.safePath(tree, path);
        if (
          !(await git(["ls-tree", base, "--", path])).startsWith("100644 blob ")
        )
          throw new WorkspacePolicyError(
            "Release requires existing regular documentation",
          );
        const blob = await git([
          "hash-object",
          "-w",
          "--no-filters",
          "--",
          path,
        ]);
        await git([
          "update-index",
          "--add",
          "--cacheinfo",
          `100644,${blob},${path}`,
        ]);
      }
      const treeId = await git(["write-tree"]);
      const commit = await git([
        "commit-tree",
        treeId,
        "-p",
        base,
        "-m",
        `Ary bounded documentation release ${run.id}`,
      ]);
      if ((await this.inspect(run)).candidate !== snapshot.candidate)
        throw new WorkspacePolicyError(
          "Candidate changed before local publication",
        );
      await git([
        "update-ref",
        ref,
        commit,
        "0000000000000000000000000000000000000000",
      ]);
      // No process/service was changed: health checks verify the actual published tree/ref.
      const healthy =
        (await git(["rev-parse", ref])) === commit &&
        (await git(["rev-parse", `${commit}^{tree}`])) === treeId &&
        (await this.inspect(run)).candidate === snapshot.candidate;
      let rolled_back = false;
      if (!healthy) {
        // Compare-and-swap touches only our private ref; never resets files or another writer.
        await git(["update-ref", ref, base, commit]);
        rolled_back = (await git(["rev-parse", ref])) === base;
      }
      return { commit, ref, rollback: base, healthy, rolled_back };
    });
  }
  async validate(run: DevelopmentRun, operation: string, signal?: AbortSignal) {
    return this.operation<ValidationReceipt>(
      run,
      "validation",
      run.workspace!.candidate,
      async () => {
        const snapshot = await this.files(run);
        if (snapshot.candidate !== run.workspace!.candidate)
          throw new WorkspacePolicyError("Candidate drift");
        const dependencies = await realpath(this.dependencies);
        const commands = [];
        for (const name of [
          "test",
          "focused",
          "typecheck",
          "format",
          "build",
        ] as CommandName[]) {
          signal?.throwIfAborted();
          if ((await this.files(run)).candidate !== snapshot.candidate)
            throw new WorkspacePolicyError("Candidate drift");
          const scratch = join(this.directory(run), `validation-${name}`);
          await mkdir(scratch, { mode: 0o700 });
          for (const p of snapshot.names) {
            const target = join(scratch, p);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(
              target,
              await readFile(join(this.worktree(run), p)),
            );
          }
          await mkdir(join(scratch, "node_modules"));
          for (const entry of await readdir(dependencies))
            if (![".cache", ".vite", ".vite-temp"].includes(entry))
              await symlink(
                join(dependencies, entry),
                join(scratch, "node_modules", entry),
              );
          const journal = join(this.directory(run), `command-${name}.json`);
          await this.store(journal, {
            status: "started",
            operation_id: operation,
            candidate: snapshot.candidate,
            command: name,
            cwd: `validation-${name}`,
            timeout_ms: commandTimeoutMs[name],
            started_at: new Date().toISOString(),
            network: "denied",
          });
          let result;
          try {
            result = await this.runner(
              name,
              scratch,
              dependencies,
              run.plan!.focused_tests,
              signal,
            );
          } catch {
            await this.store(journal, {
              status: "failed",
              operation_id: operation,
              candidate: snapshot.candidate,
              command: name,
              error: "Runner failed or cancelled; no automatic retry",
              completed_at: new Date().toISOString(),
            });
            throw new AppError(
              "Development command failed; inspect durable command receipt",
              409,
            );
          }
          commands.push(result);
          await this.store(journal, {
            status: "done",
            operation_id: operation,
            candidate: snapshot.candidate,
            cwd: `validation-${name}`,
            timeout_ms: commandTimeoutMs[name],
            network: "denied",
            completed_at: new Date().toISOString(),
            result,
          });
        }
        if ((await this.files(run)).candidate !== snapshot.candidate)
          throw new WorkspacePolicyError("Candidate drift");
        return {
          candidate: snapshot.candidate,
          commands,
          passed: commands.every(
            (c) => c.exit_code === 0 && !c.signal && !c.truncated,
          ),
          sandbox: "macos-seatbelt-deny-default-v1",
          operation_id: operation,
        };
      },
    );
  }
  async source(base: string, paths: string[]) {
    await this.init();
    if (!/^[a-f0-9]{40}$/.test(base) || paths.length > 8)
      throw new AppError("Invalid source request");
    const result = [];
    for (const p of paths) {
      sourcePath.parse(p);
      if (secretPath(p)) throw new AppError("Secret inspection forbidden", 403);
      const content = await this.git(this.repository, ["show", `${base}:${p}`]);
      if (content.length > 32000)
        throw new AppError("Source exceeds inspection budget", 413);
      if (/sk-[A-Za-z0-9_-]{16,}|-----BEGIN .*PRIVATE KEY-----/.test(content))
        throw new AppError(
          "Potential secret in source; human inspection required",
          403,
        );
      result.push({ path: p, content, hash: contentHash(content) });
    }
    return result;
  }
  async diagnostics(run: DevelopmentRun) {
    await this.init();
    await this.ownership(run);
    const receipts: import("../../domain/models").Json[] = [];
    for (const name of ["test", "focused", "typecheck", "format", "build"]) {
      try {
        const file = join(this.directory(run), `command-${name}.json`);
        const stat = await lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 3000000)
          throw new AppError("Invalid command receipt", 409);
        receipts.push(JSON.parse(await readFile(file, "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return receipts;
  }
  async cleanup(run: DevelopmentRun) {
    if (!["COMPLETED", "REJECTED"].includes(run.phase))
      throw new AppError(
        "Explicit completed owner decision required before cleanup",
        409,
      );
    return this.operation(run, "cleanup", run.plan_hash!, async () => {
      await this.ownership(run);
      const tree = this.worktree(run);
      // Includes ignored files. Never force, git-clean, reset, remove branches or recursively delete scratch/evidence.
      if (
        (
          await this.git(tree, [
            "status",
            "--porcelain",
            "--untracked-files=all",
          ])
        ).trim() ||
        (await this.git(tree, ["ls-files", "--others", "-z"])).length
      )
        throw new AppError(
          "Dirty worktree or unknown files retained; cleanup refused",
          409,
        );
      await this.git(this.repository, ["worktree", "remove", tree]);
      return { removed: true, branch_retained: true, evidence_retained: true };
    });
  }
  async releaseReservation(run: DevelopmentRun) {
    await this.init();
    try {
      await readFile(join(this.root, "repository.lock", "owner.json"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    await this.reservation(run);
    for (const name of [
      "workspace",
      "implementation",
      "validation",
      "cleanup",
    ]) {
      try {
        const r = JSON.parse(
          await readFile(join(this.directory(run), `${name}.json`), "utf8"),
        );
        if (r.status !== "done")
          throw new AppError(
            "Uncertain operation retains reservation for manual recovery",
            409,
          );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    await unlink(join(this.root, "repository.lock", "owner.json"));
    await rmdir(join(this.root, "repository.lock"));
  }
}
