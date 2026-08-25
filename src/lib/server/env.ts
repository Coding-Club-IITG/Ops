import { z } from "zod";

const runtimeConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1).default("postgresql://localhost:5432/ops"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  MONGODB_URI: z.string().min(1).default("mongodb://localhost:27017/ops"),
  AUTH_SECRET: z
    .string()
    .min(32)
    .default("local-development-secret-change-me-now"),
  BASE_URL: z.string().url().default("http://localhost:3005"),
  TRUSTED_ORIGINS: z.string().default("http://localhost:3005"),
  AZURE_CLIENT_ID: z.string().min(1).default("replace-with-azure-client-id"),
  AZURE_CLIENT_SECRET: z
    .string()
    .min(1)
    .default("replace-with-azure-client-secret"),
  AZURE_TENANT_ID: z.string().min(1).default("replace-with-azure-tenant-id"),
  LOG_RETENTION_DAYS: z.coerce.number().int().positive().max(365).default(30),
  LOG_STREAM_KEY: z.string().min(1).default("ops:logs:v1"),
  LOG_LIVE_CHANNEL: z.string().min(1).default("ops:logs:live:v1"),
  LOG_CONSUMER_GROUP: z.string().min(1).default("ops-workers-v1"),
  LOG_CONSUMER_NAME: z.string().min(1).default(`ops-worker-${process.pid}`),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

let config: RuntimeConfig | undefined;

export function getRuntimeConfig(): RuntimeConfig {
  if (!config) {
    const databaseUrl = process.env.DATABASE_URL ?? buildLegacyDatabaseUrl();
    config = runtimeConfigSchema.parse({
      ...process.env,
      DATABASE_URL: databaseUrl,
    });
    const productionRuntime =
      config.NODE_ENV === "production" &&
      process.env.NEXT_PHASE !== "phase-production-build";
    if (productionRuntime) {
      const missing = [
        "DATABASE_URL",
        "REDIS_URL",
        "MONGODB_URI",
        "AUTH_SECRET",
        "BASE_URL",
        "TRUSTED_ORIGINS",
        "AZURE_CLIENT_ID",
        "AZURE_CLIENT_SECRET",
        "AZURE_TENANT_ID",
      ].filter((key) => !process.env[key]);
      if (missing.length)
        throw new Error(
          `Missing required production configuration: ${missing.join(", ")}`,
        );
    }
  }
  return config;
}

function buildLegacyDatabaseUrl(): string | undefined {
  if (!process.env.DB_NAME) return undefined;

  const user = encodeURIComponent(process.env.DB_USER ?? "postgres");
  const password = encodeURIComponent(process.env.DB_PASSWORD ?? "");
  const credentials = password ? `${user}:${password}` : user;
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";
  return `postgresql://${credentials}@${host}:${port}/${process.env.DB_NAME}`;
}
