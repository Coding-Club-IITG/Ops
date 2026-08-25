import { createClient } from "redis";
import { getRuntimeConfig } from "@/lib/server/env";

export function createRedisConnection() {
  const client = createClient({
    url: getRuntimeConfig().REDIS_URL,
    socket: {
      connectTimeout: 3_000,
      reconnectStrategy: (retries) => Math.min(retries * 100, 3_000),
    },
  });
  client.on("error", (error) => console.error("Redis connection error", error));
  return client;
}

type RedisConnection = ReturnType<typeof createRedisConnection>;

let webRedis: RedisConnection | undefined;

export async function getWebRedis(): Promise<RedisConnection> {
  webRedis ??= createRedisConnection();
  if (!webRedis.isOpen) await webRedis.connect();
  return webRedis;
}

export async function checkRedis(): Promise<void> {
  const redis = await getWebRedis();
  await redis.ping();
}
