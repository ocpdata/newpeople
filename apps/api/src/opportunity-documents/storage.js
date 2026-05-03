import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "../config.js";

function ensureProvider(expectedProvider) {
  if (config.documents.storage.provider !== expectedProvider) {
    throw new Error(
      `Unsupported document storage provider: ${config.documents.storage.provider}`,
    );
  }
}

export class LocalFilesystemDocumentStorage {
  constructor(rootPath = config.documents.storage.localRoot) {
    ensureProvider("local_fs");
    this.rootPath = rootPath;
  }

  resolveStoragePath(storageKey) {
    return path.join(this.rootPath, storageKey);
  }

  async save({ buffer, storageKey }) {
    const absolutePath = this.resolveStoragePath(storageKey);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);

    return {
      storageProvider: "local_fs",
      storageBucket: null,
      storageKey,
      storedFileName: path.basename(storageKey),
    };
  }

  async exists({ storageKey }) {
    try {
      await stat(this.resolveStoragePath(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  async delete({ storageKey }) {
    try {
      await unlink(this.resolveStoragePath(storageKey));
    } catch {
      // Best-effort delete to keep database cleanup idempotent.
    }
  }

  async openReadStream({ storageKey }) {
    return createReadStream(this.resolveStoragePath(storageKey));
  }

  async readBuffer({ storageKey }) {
    return await import("node:fs/promises").then(({ readFile }) =>
      readFile(this.resolveStoragePath(storageKey)),
    );
  }
}

export class S3CompatibleDocumentStorage {
  constructor() {
    ensureProvider("s3_compatible");

    if (!config.documents.storage.s3Bucket) {
      throw new Error("DOCUMENT_STORAGE_S3_BUCKET es requerido");
    }

    this.bucket = config.documents.storage.s3Bucket;
    this.client = new S3Client({
      region: config.documents.storage.s3Region,
      endpoint: config.documents.storage.s3Endpoint || undefined,
      forcePathStyle: config.documents.storage.s3ForcePathStyle,
      credentials:
        config.documents.storage.s3AccessKeyId &&
        config.documents.storage.s3SecretAccessKey
          ? {
              accessKeyId: config.documents.storage.s3AccessKeyId,
              secretAccessKey: config.documents.storage.s3SecretAccessKey,
            }
          : undefined,
    });
  }

  async save({ buffer, storageKey }) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: buffer,
      }),
    );

    return {
      storageProvider: "s3_compatible",
      storageBucket: this.bucket,
      storageKey,
      storedFileName: path.basename(storageKey),
    };
  }

  async exists({ storageKey, storageBucket }) {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: storageBucket || this.bucket,
          Key: storageKey,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async delete({ storageKey, storageBucket }) {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: storageBucket || this.bucket,
          Key: storageKey,
        }),
      );
    } catch {
      // Best-effort delete to keep database cleanup idempotent.
    }
  }

  async openReadStream({ storageKey, storageBucket }) {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: storageBucket || this.bucket,
        Key: storageKey,
      }),
    );

    if (response.Body?.pipe) {
      return response.Body;
    }

    if (response.Body?.transformToWebStream) {
      return Readable.fromWeb(response.Body.transformToWebStream());
    }

    throw new Error("No fue posible abrir el stream del documento remoto");
  }

  async readBuffer({ storageKey, storageBucket }) {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: storageBucket || this.bucket,
        Key: storageKey,
      }),
    );

    if (response.Body?.transformToByteArray) {
      const byteArray = await response.Body.transformToByteArray();
      return Buffer.from(byteArray);
    }

    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

export function createDocumentStorage() {
  if (config.documents.storage.provider === "local_fs") {
    return new LocalFilesystemDocumentStorage();
  }

  if (config.documents.storage.provider === "s3_compatible") {
    return new S3CompatibleDocumentStorage();
  }

  throw new Error(
    `Unsupported document storage provider: ${config.documents.storage.provider}`,
  );
}
