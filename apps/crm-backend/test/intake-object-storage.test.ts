import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FilesystemObjectStore,
  MemoryObjectStore,
  ObjectStoreReadError,
  ObjectStoreWriteError,
} from "../src/modules/intake/object-storage.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("bounded intake object reads", () => {
  it("returns a defensive copy within the explicit byte limit", async () => {
    const store = new MemoryObjectStore();
    const original = new Uint8Array([1, 2, 3]);
    await store.put("internal/key", original, "application/octet-stream");
    original[0] = 9;

    const first = await store.read("internal/key", 3);
    first[1] = 9;
    const second = await store.read("internal/key", 3);

    expect(Array.from(second)).toEqual([1, 2, 3]);
  });

  it("makes a stable key idempotent for exact bytes and rejects conflicting content", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kns-upload-idempotency-"));
    temporaryDirectories.push(directory);
    for (const store of [new MemoryObjectStore(), new FilesystemObjectStore(directory)]) {
      await store.put("quarantine/staged/stable-key", new Uint8Array([1, 2, 3]), "application/pdf");
      await expect(
        store.put("quarantine/staged/stable-key", new Uint8Array([1, 2, 3]), "application/pdf"),
      ).resolves.toBeUndefined();
      await expect(
        store.put("quarantine/staged/stable-key", new Uint8Array([3, 2, 1]), "application/pdf"),
      ).rejects.toBeInstanceOf(ObjectStoreWriteError);
    }
  });

  it("fails closed without including an internal key in the error", async () => {
    const store = new MemoryObjectStore();
    await store.put("secret/storage/key", new Uint8Array([1, 2, 3]), "application/octet-stream");

    await expect(store.read("secret/storage/key", 2)).rejects.toMatchObject({
      name: "ObjectStoreReadError",
      reason: "too_large",
    });
    await expect(store.read("missing/secret/key", 10)).rejects.toBeInstanceOf(ObjectStoreReadError);

    try {
      await store.read("missing/secret/key", 10);
    } catch (error) {
      expect((error as Error).message).not.toContain("missing/secret/key");
    }
  });
});
