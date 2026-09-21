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
import { forbiddenPath, sourcePath } from "../../domain/self-development";
import { AppError } from "../../domain/validation";
import { runSandboxed, type SandboxedCommand } from "./runner";

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
    ).then((r) => r.stdout);
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
          "Repository reserved by another development run; queued until owner releases it",
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
  private async files(run: DevelopmentRun, includePatch = true) {
    const tree = this.worktree(run);
    const tracked = (await this.git(tree, ["ls-files", "-z"]))
      .split("\0")
      .filter(Boolean);
    if (
      (await this.git(tree, ["rev-parse", "HEAD"])).trim() !==
      run.plan!.base_commit
    )
      throw new AppError("Worktree base changed", 409);
    const untracked = (await this.git(tree, ["ls-files", "--others", "-z"]))
      .split("\0")
      .filter(Boolean);
    if (
      untracked.some((p) => !run.patch?.value.changes.some((c) => c.path === p))
    )
      throw new AppError("Unexpected untracked worktree file", 409);
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
      if (
        p !== ".env.example" &&
        /(^|\/)(?:\.env[^/]*|\.data|credentials?|secrets?)(?:\/|$)/i.test(p)
      )
        throw new AppError(
          "Tracked secrets cannot enter development snapshot",
          403,
        );
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
          throw new AppError("Worktree changed before implementation", 409);
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
          change.content
            .split("\n")
            .map((l) => "+" + l)
            .join("\n");
    if (diff.length > 96000)
      throw new AppError("Diff exceeds review budget", 413);
    return {
      candidate,
      diff,
      files: run.patch?.value.changes.map((c) => c.path) ?? [],
    };
  }
  async validate(run: DevelopmentRun, operation: string, signal?: AbortSignal) {
    return this.operation<ValidationReceipt>(
      run,
      "validation",
      run.workspace!.candidate,
      async () => {
        const snapshot = await this.files(run);
        if (snapshot.candidate !== run.workspace!.candidate)
          throw new AppError("Candidate drift", 409);
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
            throw new AppError("Candidate drift", 409);
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
          commands.push(
            await this.runner(
              name,
              scratch,
              dependencies,
              run.plan!.focused_tests,
              signal,
            ),
          );
        }
        if ((await this.files(run)).candidate !== snapshot.candidate)
          throw new AppError("Candidate drift", 409);
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
      if (
        /(^|\/)(?:\.env[^/]*|\.git|\.data|credentials?|secrets?|vault)(?:\/|$)/i.test(
          p,
        )
      )
        throw new AppError("Secret inspection forbidden", 403);
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
  async releaseReservation(run: DevelopmentRun) {
    await this.init();
    try {
      await readFile(join(this.root, "repository.lock", "owner.json"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    await this.reservation(run);
    for (const name of ["workspace", "implementation", "validation"]) {
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
