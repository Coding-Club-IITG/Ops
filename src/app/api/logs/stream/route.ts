import { createRedisConnection } from "@/lib/server/redis";
import { getRuntimeConfig } from "@/lib/server/env";
import {
  requireOperator,
  unauthorizedResponse,
} from "@/lib/server/authorization";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (!(await requireOperator(request))) return unauthorizedResponse();

  const redis = createRedisConnection();
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = async () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (redis.isOpen) await redis.close();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      request.signal.addEventListener("abort", () => void close(), {
        once: true,
      });
      try {
        await redis.connect();
        await redis.subscribe(
          getRuntimeConfig().LOG_LIVE_CHANNEL,
          (message) => {
            if (!closed)
              controller.enqueue(
                encoder.encode(`event: log\ndata: ${message}\n\n`),
              );
          },
        );
        controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`));
        heartbeat = setInterval(() => {
          if (!closed)
            controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        }, 15_000);
      } catch (error) {
        console.error("Log stream failed", error);
        await close();
      }
    },
    async cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (redis.isOpen) await redis.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
