import { checkMongo } from "@/lib/server/mongo";
import { checkPostgres } from "@/lib/server/postgres";
import { checkRedis } from "@/lib/server/redis";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const checks = await Promise.allSettled([
    checkPostgres(),
    checkRedis(),
    checkMongo(),
  ]);
  const names = ["postgres", "redis", "mongo"] as const;
  const dependencies = Object.fromEntries(
    checks.map((result, index) => [
      names[index],
      result.status === "fulfilled" ? "ready" : "unavailable",
    ]),
  );
  const ready = checks.every((result) => result.status === "fulfilled");
  return Response.json(
    { status: ready ? "ready" : "not_ready", dependencies },
    { status: ready ? 200 : 503 },
  );
}
