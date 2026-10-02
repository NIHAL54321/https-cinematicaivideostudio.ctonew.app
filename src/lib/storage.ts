import { Client } from "minio";
import { env } from "@/lib/env";

/**
 * S3-compatible object storage foundation (MinIO / AWS S3 / any S3 endpoint).
 * All functions fail soft: when storage is not configured they throw a
 * StorageNotConfigured error which callers can map to a clear UI state —
 * never a fake success.
 */

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Storage not configured. Set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY and S3_BUCKET.");
    this.name = "StorageNotConfiguredError";
  }
}

export function storageIsConfigured(): boolean {
  return Boolean(env.s3Endpoint && env.s3AccessKey && env.s3SecretKey && env.s3Bucket);
}

export function storageConfig() {
  return {
    configured: storageIsConfigured(),
    endpoint: env.s3Endpoint,
    bucket: env.s3Bucket,
    region: env.s3Region,
    publicUrl: env.s3PublicUrl,
  };
}

function parseEndpoint(endpoint: string): { endPoint: string; port: number; useSSL: boolean } {
  const url = new URL(endpoint);
  return {
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    useSSL: url.protocol === "https:",
  };
}

let client: Client | null = null;
let bucketEnsured = false;

export function getStorageClient(): Client {
  if (!storageIsConfigured()) throw new StorageNotConfiguredError();
  if (!client) {
    const { endPoint, port, useSSL } = parseEndpoint(env.s3Endpoint);
    client = new Client({
      endPoint,
      port,
      useSSL,
      accessKey: env.s3AccessKey,
      secretKey: env.s3SecretKey,
      region: env.s3Region,
      pathStyle: env.s3ForcePathStyle,
    });
  }
  return client;
}

export async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const c = getStorageClient();
  const exists = await c.bucketExists(env.s3Bucket);
  if (!exists) await c.makeBucket(env.s3Bucket, env.s3Region);
  bucketEnsured = true;
}

export async function putObject(params: {
  key: string;
  data: string | Buffer | import("stream").Readable;
  size?: number;
  contentType?: string;
}): Promise<string> {
  await ensureBucket();
  const c = getStorageClient();
  await c.putObject(
    env.s3Bucket,
    params.key,
    params.data,
    params.size,
    { "Content-Type": params.contentType ?? "application/octet-stream" },
  );
  return params.key;
}

export async function presignedGetUrl(key: string, expirySeconds = 3600): Promise<string> {
  const c = getStorageClient();
  return c.presignedGetObject(env.s3Bucket, key, expirySeconds);
}

export async function presignedPutUrl(key: string, expirySeconds = 3600): Promise<string> {
  await ensureBucket();
  const c = getStorageClient();
  return c.presignedPutObject(env.s3Bucket, key, expirySeconds);
}

export async function removeObject(key: string): Promise<void> {
  const c = getStorageClient();
  await c.removeObject(env.s3Bucket, key);
}

/** Object key helper: user-scoped keys so cross-tenant access is impossible by construction. */
export function userObjectKey(userId: string, kind: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${userId}/${kind}/${Date.now()}-${safe}`;
}
