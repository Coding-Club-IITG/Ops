import { Pool } from "pg";
import { getRuntimeConfig } from "@/lib/server/env";

const globalForPostgres = globalThis as unknown as { opsPostgres?: Pool };

export function getPostgresPool(): Pool {
  if (!globalForPostgres.opsPostgres) {
    globalForPostgres.opsPostgres = new Pool({
      connectionString: getRuntimeConfig().DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 3_000,
      application_name: "ops-web",
    });
  }

  return globalForPostgres.opsPostgres;
}

export async function checkPostgres(): Promise<void> {
  await getPostgresPool().query("SELECT 1");
}
