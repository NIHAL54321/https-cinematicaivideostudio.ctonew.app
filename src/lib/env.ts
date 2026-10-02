/**
 * Server-only environment access. NEVER import this from client components.
 * All AI provider keys are server-side env vars only.
 */

export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  authSecret: process.env.AUTH_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3AccessKey: process.env.S3_ACCESS_KEY ?? "",
  s3SecretKey: process.env.S3_SECRET_KEY ?? "",
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  s3PublicUrl: process.env.S3_PUBLIC_URL ?? "",
  cookieSecure: process.env.COOKIE_SECURE === "true",
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
};

/** Provider keys — server-side only. Keyed by the provider's canonical name. */
export const providerEnvKeys = {
  openai: process.env.OPENAI_API_KEY ?? "",
  anthropic: process.env.ANTHROPIC_API_KEY ?? "",
  google: process.env.GOOGLE_API_KEY ?? "",
  replicate: process.env.REPLICATE_API_TOKEN ?? "",
  runway: process.env.RUNWAY_API_KEY ?? "",
  elevenlabs: process.env.ELEVENLABS_API_KEY ?? "",
  stability: process.env.STABILITY_API_KEY ?? "",
  pexels: process.env.PEXELS_API_KEY ?? "",
  unsplash: process.env.UNSPLASH_ACCESS_KEY ?? "",
} as const;

export type ProviderName = keyof typeof providerEnvKeys;

export function isProviderConfigured(name: ProviderName): boolean {
  return providerEnvKeys[name].length > 0;
}

export function configuredProviders(): ProviderName[] {
  return (Object.keys(providerEnvKeys) as ProviderName[]).filter((k) =>
    isProviderConfigured(k),
  );
}
