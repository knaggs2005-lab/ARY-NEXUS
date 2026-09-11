import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  realpath,
  readdir,
  open,
  mkdir,
  link,
  unlink,
} from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { AppError } from "../../domain/validation";
/** Explicit transfer directory only; never a general filesystem executor. */
export class ControlFiles {
  constructor(private directory: string) {}
  private async root() {
    if (!this.directory || !this.directory.startsWith("/"))
      throw new AppError(
        "Configure ARY_CONTROL_TRANSFER_DIR to an absolute transfer folder",
        503,
      );
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const root = await realpath(this.directory);
    if (
      root === "/" ||
      root === process.env.HOME ||
      /\/(\.ssh|\.aws|\.codex|Library)(\/|$)/.test(root)
    )
      throw new AppError("Use a dedicated transfer folder", 403);
    return root;
  }
  private name(name: string) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,150}$/.test(name) ||
      name.includes("..") ||
      ![
        ".txt",
        ".csv",
        ".json",
        ".pdf",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".md",
      ].includes(extname(name).toLowerCase())
    )
      throw new AppError(
        "Invalid transfer filename or unsupported file type",
        400,
      );
    return name;
  }
  async list() {
    const root = await this.root(),
      files = [];
    for (const name of (await readdir(root)).slice(0, 200)) {
      try {
        this.name(name);
        const s = await lstat(join(root, name));
        if (s.isFile() && !s.isSymbolicLink() && s.size <= 10 * 1024 * 1024)
          files.push({ id: name, bytes: s.size });
      } catch {
        /* Ignore files outside the transfer contract. */
      }
    }
    return files;
  }
  async read(name: string) {
    const path = join(await this.root(), this.name(name));
    const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const s = await f.stat();
      if (!s.isFile() || s.size > 10 * 1024 * 1024)
        throw new AppError("Transfer file must be at most 10 MB", 413);
      const buffer = Buffer.alloc(10 * 1024 * 1024 + 1);
      let offset = 0;
      try {
        while (offset < buffer.length) {
          const read = await f.read(
            buffer,
            offset,
            buffer.length - offset,
            offset,
          );
          if (!read.bytesRead) break;
          offset += read.bytesRead;
        }
        if (offset > 10 * 1024 * 1024)
          throw new AppError("Transfer file grew beyond 10 MB", 413);
        return {
          name,
          buffer: Buffer.from(buffer.subarray(0, offset)),
          mimeType: "application/octet-stream",
        };
      } finally {
        buffer.fill(0);
      }
    } finally {
      await f.close();
    }
  }
  async write(name: string, bytes: Buffer) {
    this.name(name);
    if (bytes.length > 10 * 1024 * 1024)
      throw new AppError("Download exceeds 10 MB", 413);
    const root = await this.root(),
      path = resolve(root, name),
      temp = join(root, `.${randomUUID()}.part`),
      f = await open(temp, "wx", 0o600);
    try {
      await f.writeFile(bytes);
      await f.sync();
      await f.close();
      await link(temp, path);
    } finally {
      await f.close();
      await unlink(temp);
    }
    return { file_id: basename(path), bytes: bytes.length };
  }
}
