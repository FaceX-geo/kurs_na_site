import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { Client as MinioClient } from "minio";
import { assertUploadLimitWithinStorageCeiling } from "../../common/upload-policy.js";
import type { AppConfig } from "../../config/env.js";

export interface QuarantineObjectStore {
  put(key: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  /** Reads at most maxBytes. The caller must obtain and re-check its database authorization gate. */
  read(key: string, maxBytes: number): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
  ping(): Promise<void>;
}

export class ObjectStoreReadError extends Error {
  constructor(readonly reason: "not_found" | "not_regular" | "too_large" | "unavailable") {
    super(`Object content is ${reason.replaceAll("_", " ")}`);
    this.name = "ObjectStoreReadError";
  }
}

export class ObjectStoreWriteError extends Error {
  constructor(readonly reason: "key_conflict" | "unavailable") {
    super(`Object write is ${reason.replaceAll("_", " ")}`);
    this.name = "ObjectStoreWriteError";
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && Buffer.from(left).equals(Buffer.from(right));
}

function assertReadLimit(maxBytes: number): void {
  assertUploadLimitWithinStorageCeiling(maxBytes, "Object read limit");
}

async function readBoundedStream(stream: Readable, maxBytes: number): Promise<Uint8Array> {
  assertReadLimit(maxBytes);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
      total += chunk.byteLength;
      if (total > maxBytes) {
        stream.destroy();
        throw new ObjectStoreReadError("too_large");
      }
      chunks.push(chunk);
    }
    return Uint8Array.from(Buffer.concat(chunks, total));
  } catch (error) {
    if (error instanceof ObjectStoreReadError) throw error;
    throw new ObjectStoreReadError("unavailable");
  }
}

export class MemoryObjectStore implements QuarantineObjectStore {
  private readonly objects = new Map<string, Uint8Array>();

  async put(key: string, bytes: Uint8Array, _mediaType: string): Promise<void> {
    const existing = this.objects.get(key);
    if (existing) {
      if (!bytesEqual(existing, bytes)) throw new ObjectStoreWriteError("key_conflict");
      return;
    }
    this.objects.set(key, Uint8Array.from(bytes));
  }

  async read(key: string, maxBytes: number): Promise<Uint8Array> {
    assertReadLimit(maxBytes);
    const bytes = this.objects.get(key);
    if (!bytes) throw new ObjectStoreReadError("not_found");
    if (bytes.byteLength > maxBytes) throw new ObjectStoreReadError("too_large");
    return Uint8Array.from(bytes);
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async ping(): Promise<void> {
    const key = `.readiness/${randomUUID()}`;
    await this.put(key, new Uint8Array([1]), "application/octet-stream");
    await this.remove(key);
  }
}

export class FilesystemObjectStore implements QuarantineObjectStore {
  constructor(private readonly root: string) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    try {
      await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new ObjectStoreWriteError("unavailable");
      }
      let existing: Uint8Array;
      try {
        existing = await readFile(target);
      } catch {
        throw new ObjectStoreWriteError("unavailable");
      }
      if (!bytesEqual(existing, bytes)) throw new ObjectStoreWriteError("key_conflict");
    }
  }

  async read(key: string, maxBytes: number): Promise<Uint8Array> {
    assertReadLimit(maxBytes);
    const target = this.resolve(key);
    let metadata: Awaited<ReturnType<typeof stat>>;
    try {
      metadata = await stat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ObjectStoreReadError("not_found");
      }
      throw new ObjectStoreReadError("unavailable");
    }
    if (!metadata.isFile()) throw new ObjectStoreReadError("not_regular");
    if (metadata.size > maxBytes) throw new ObjectStoreReadError("too_large");
    try {
      const bytes = await readFile(target);
      if (bytes.byteLength > maxBytes) throw new ObjectStoreReadError("too_large");
      return Uint8Array.from(bytes);
    } catch (error) {
      if (error instanceof ObjectStoreReadError) throw error;
      throw new ObjectStoreReadError("unavailable");
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async ping(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const probe = this.resolve(`.readiness/${randomUUID()}`);
    await mkdir(path.dirname(probe), { recursive: true, mode: 0o700 });
    let written = false;
    try {
      await writeFile(probe, new Uint8Array([1]), { flag: "wx", mode: 0o600 });
      written = true;
    } finally {
      if (written) {
        await rm(probe, { force: true });
      }
    }
  }

  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    const root = path.resolve(this.root);
    if (!target.startsWith(`${root}${path.sep}`)) {
      throw new Error("Object key escapes storage root");
    }
    return target;
  }
}

export class S3ObjectStore implements QuarantineObjectStore {
  private readonly client: MinioClient;

  constructor(
    private readonly bucket: string,
    endpoint: string,
    accessKey: string,
    secretKey: string,
    private readonly allowBucketCreation: boolean,
  ) {
    const url = new URL(endpoint);
    this.client = new MinioClient({
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      useSSL: url.protocol === "https:",
      accessKey,
      secretKey,
    });
  }

  async put(key: string, bytes: Uint8Array, mediaType: string): Promise<void> {
    await this.ensureBucket();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    try {
      const existing = await this.client.statObject(this.bucket, key);
      const metadata = existing.metaData as Readonly<Record<string, string | undefined>>;
      const existingSha256 = metadata["x-amz-meta-sha256"] ?? metadata.sha256;
      if (existing.size === bytes.byteLength && existingSha256 === sha256) {
        return;
      }
      throw new ObjectStoreWriteError("key_conflict");
    } catch (error) {
      if (error instanceof ObjectStoreWriteError) throw error;
      const code = (error as { code?: unknown }).code;
      if (code !== "NoSuchKey" && code !== "NotFound" && code !== "NoSuchObject") {
        throw new ObjectStoreWriteError("unavailable");
      }
    }
    await this.client.putObject(this.bucket, key, Buffer.from(bytes), bytes.byteLength, {
      "Content-Type": mediaType,
      "X-Amz-Meta-Quarantine": "true",
      "X-Amz-Meta-Sha256": sha256,
    });
  }

  async read(key: string, maxBytes: number): Promise<Uint8Array> {
    assertReadLimit(maxBytes);
    try {
      const stream = await this.client.getObject(this.bucket, key);
      return await readBoundedStream(stream, maxBytes);
    } catch (error) {
      if (error instanceof ObjectStoreReadError) throw error;
      const code = (error as { code?: unknown }).code;
      if (code === "NoSuchKey" || code === "NotFound") {
        throw new ObjectStoreReadError("not_found");
      }
      throw new ObjectStoreReadError("unavailable");
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  async ping(): Promise<void> {
    await this.ensureBucket();
    const key = `.readiness/${randomUUID()}`;
    let written = false;
    try {
      await this.put(key, new Uint8Array([1]), "application/octet-stream");
      written = true;
    } finally {
      if (written) {
        await this.remove(key);
      }
    }
  }

  private async ensureBucket(): Promise<void> {
    if (await this.client.bucketExists(this.bucket)) {
      return;
    }
    if (!this.allowBucketCreation) {
      throw new Error(`Required object storage bucket ${this.bucket} does not exist`);
    }
    await this.client.makeBucket(this.bucket);
  }
}

export function createObjectStore(config: AppConfig): QuarantineObjectStore {
  switch (config.uploads.driver) {
    case "memory":
      return new MemoryObjectStore();
    case "filesystem":
      return new FilesystemObjectStore(config.uploads.filesystemPath);
    case "s3":
      return new S3ObjectStore(
        config.uploads.s3.bucket,
        config.uploads.s3.endpoint,
        config.uploads.s3.accessKeyId,
        config.uploads.s3.secretAccessKey,
        config.nodeEnv !== "production",
      );
  }
}
