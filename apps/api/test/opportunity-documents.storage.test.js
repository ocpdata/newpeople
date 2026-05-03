import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    async send(command) {
      return mockSend(command);
    }
  }

  class PutObjectCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class GetObjectCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class DeleteObjectCommand {
    constructor(input) {
      this.input = input;
    }
  }

  class HeadObjectCommand {
    constructor(input) {
      this.input = input;
    }
  }

  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
  };
});

import { config } from "../src/config.js";
import {
  LocalFilesystemDocumentStorage,
  S3CompatibleDocumentStorage,
  createDocumentStorage,
} from "../src/opportunity-documents/storage.js";

describe("opportunity document storage", () => {
  const originalStorageConfig = structuredClone(config.documents.storage);

  beforeEach(() => {
    mockSend.mockReset();
  });

  afterEach(() => {
    Object.assign(
      config.documents.storage,
      structuredClone(originalStorageConfig),
    );
  });

  test("createDocumentStorage devuelve provider local cuando local_fs esta activo", () => {
    config.documents.storage.provider = "local_fs";
    const storage = createDocumentStorage();
    expect(storage).toBeInstanceOf(LocalFilesystemDocumentStorage);
  });

  test("createDocumentStorage devuelve provider s3 compatible y guarda en el bucket configurado", async () => {
    config.documents.storage.provider = "s3_compatible";
    config.documents.storage.s3Bucket = "documents-bucket";
    config.documents.storage.s3Region = "us-east-1";
    config.documents.storage.s3Endpoint = "http://localhost:9000";
    config.documents.storage.s3AccessKeyId = "minio";
    config.documents.storage.s3SecretAccessKey = "minio123";

    mockSend.mockResolvedValue({});

    const storage = createDocumentStorage();
    expect(storage).toBeInstanceOf(S3CompatibleDocumentStorage);

    const result = await storage.save({
      buffer: Buffer.from("hola", "utf8"),
      storageKey: "crm/docs/test.txt",
    });

    expect(result).toEqual(
      expect.objectContaining({
        storageProvider: "s3_compatible",
        storageBucket: "documents-bucket",
        storageKey: "crm/docs/test.txt",
      }),
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].input).toEqual(
      expect.objectContaining({
        Bucket: "documents-bucket",
        Key: "crm/docs/test.txt",
      }),
    );
  });
});
