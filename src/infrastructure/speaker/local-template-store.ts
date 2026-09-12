import {
  speakerTemplate,
  type SpeakerTemplate,
  type SpeakerTemplateStore,
} from "../../domain/owner-voice";
export type EncryptedSpeakerRecord = {
  key: CryptoKey;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
};
export interface SpeakerRecordStore {
  get(owner: string): Promise<EncryptedSpeakerRecord | undefined>;
  put(owner: string, record: EncryptedSpeakerRecord): Promise<void>;
  delete(owner: string): Promise<void>;
}
/** Non-exportable local AES key. Neither raw voice nor plaintext template enters storage. */
export class EncryptedSpeakerTemplateStore implements SpeakerTemplateStore {
  constructor(
    private owner: string,
    private records: SpeakerRecordStore,
  ) {
    if (!/^[a-f0-9-]{36}$/i.test(owner))
      throw new Error("AUTHENTICATED_OWNER_REQUIRED");
  }
  private aad() {
    return new TextEncoder().encode(`ary-owner-voice-v1:${this.owner}`);
  }
  async read() {
    const record = await this.records.get(this.owner);
    if (!record) return null;
    const clear = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Uint8Array.from(record.iv),
        additionalData: this.aad(),
      },
      record.key,
      record.ciphertext,
    );
    try {
      return speakerTemplate.parse(JSON.parse(new TextDecoder().decode(clear)));
    } finally {
      new Uint8Array(clear).fill(0);
    }
  }
  async write(value: SpeakerTemplate) {
    const template = speakerTemplate.parse(value),
      key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      ),
      iv = crypto.getRandomValues(new Uint8Array(12)),
      clear = new TextEncoder().encode(JSON.stringify(template));
    try {
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: this.aad() },
        key,
        clear,
      );
      await this.records.put(this.owner, { key, iv, ciphertext });
    } finally {
      clear.fill(0);
    }
  }
  delete() {
    return this.records.delete(this.owner);
  }
}
export class IndexedDbSpeakerRecords implements SpeakerRecordStore {
  private async transaction<T>(
    owner: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("ary-owner-voice-v1", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("templates");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new Error("LOCAL_VAULT_UNAVAILABLE"));
      r.onblocked = () => reject(new Error("LOCAL_VAULT_BLOCKED"));
    });
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction("templates", mode),
          req = operation(tx.objectStore("templates"));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(new Error("LOCAL_VAULT_FAILED"));
        tx.onabort = () => reject(new Error("LOCAL_VAULT_ABORTED"));
      });
    } finally {
      db.close();
    }
  }
  get(owner: string) {
    return this.transaction(owner, "readonly", (s) => s.get(owner));
  }
  async put(owner: string, record: EncryptedSpeakerRecord) {
    await this.transaction(owner, "readwrite", (s) => s.put(record, owner));
  }
  async delete(owner: string) {
    await this.transaction(owner, "readwrite", (s) => s.delete(owner));
  }
}
