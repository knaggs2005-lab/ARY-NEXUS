import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  createHash,
} from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm, open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { AppError } from "../../domain/validation";
/** Replaceable server-only storage boundary. Never expose credentials through repositories or APIs. */
export interface CalendarVault {
  read<T>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
  take<T>(key: string): Promise<T | null>;
  remove(key: string): Promise<void>;
  lock<T>(key: string, work: () => Promise<T>): Promise<T>;
}
export class EncryptedCalendarVault implements CalendarVault {
  constructor(
    private directory = resolve(
      process.env.ARY_CALENDAR_VAULT_DIR || ".data/calendar-vault",
    ),
    private secret = process.env.ARY_INTEGRATION_ENCRYPTION_KEY || "",
  ) {}
  private key() {
    if (!/^[a-f0-9]{64}$/i.test(this.secret))
      throw new AppError("Calendar encryption key is not configured", 503);
    return Buffer.from(this.secret, "hex");
  }
  private path(key: string) {
    return join(this.directory, createHash("sha256").update(key).digest("hex"));
  }
  async read<T>(key: string): Promise<T | null> {
    let raw: string;
    try {
      raw = await readFile(this.path(key), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    const [iv, tag, cipher] = raw.split(".");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key(),
      Buffer.from(iv, "hex"),
    );
    decipher.setAAD(Buffer.from(key));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(cipher, "hex")),
        decipher.final(),
      ]).toString("utf8"),
    ) as T;
  }
  async write(key: string, value: unknown) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    cipher.setAAD(Buffer.from(key));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    const temp = this.path(key) + "." + randomUUID();
    await writeFile(
      temp,
      [
        iv.toString("hex"),
        cipher.getAuthTag().toString("hex"),
        encrypted.toString("hex"),
      ].join("."),
      { mode: 0o600 },
    );
    await rename(temp, this.path(key));
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
  async take<T>(key: string) {
    return this.lock(key, async () => {
      const result = await this.read<T>(key);
      await this.remove(key);
      return result;
    });
  }
  async lock<T>(key: string, work: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let file;
    try {
      file = await open(this.path(key) + ".lock", "wx", 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new AppError(
          "Calendar operation is already running; retry shortly",
          409,
        );
      throw e;
    }
    try {
      return await work();
    } finally {
      await file.close();
      await rm(this.path(key) + ".lock", { force: true });
    }
  }
}
