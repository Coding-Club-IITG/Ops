import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  createOpsLogger,
  type OpsLogger,
  type OpsLoggerConfig,
} from "./index.js";
import { OPS_LOGGER_INTERNAL, type OpsLoggerInternal } from "./internal.js";
import { isSafeRouteTemplate } from "@coding-club-iitg/ops-contract";

type RequestLike = {
  method?: string;
  route?: { path?: unknown };
  baseUrl?: unknown;
};
type ResponseLike = {
  statusCode?: number;
  once(event: "finish" | "close", listener: () => void): unknown;
  removeListener?(event: "finish" | "close", listener: () => void): unknown;
};
export type ExpressNext = (error?: unknown) => void;
export type ExpressMiddleware = (
  req: RequestLike,
  res: ResponseLike,
  next: ExpressNext,
) => void;

export type ExpressOpsLogger = {
  logger: OpsLogger;
  middleware: ExpressMiddleware;
  getCorrelationId(): string | undefined;
};

const store = new AsyncLocalStorage<{ correlationId: string }>();

function safeRoute(req: RequestLike): string {
  const path = typeof req.route?.path === "string" ? req.route.path : undefined;
  if (!path) return "unmatched";
  const base = typeof req.baseUrl === "string" ? req.baseUrl : "";
  const candidate = `${base}${path}`.replace(/\/+/g, "/") || "/";
  return isSafeRouteTemplate(candidate) ? candidate : "unknown";
}

/** Creates a logger and middleware that share request-local correlation context. */
export function createExpressOpsLogger(
  config: OpsLoggerConfig,
): ExpressOpsLogger {
  const logger = createOpsLogger({
    ...config,
    getCorrelationId: () => store.getStore()?.correlationId,
  });
  const internal = (
    logger as OpsLogger & { [OPS_LOGGER_INTERNAL]: OpsLoggerInternal }
  )[OPS_LOGGER_INTERNAL];
  const middleware: ExpressMiddleware = (req, res, next) => {
    const correlationId = randomUUID();
    const started = process.hrtime.bigint();
    let emitted = false;
    const complete = () => {
      if (emitted) return;
      emitted = true;
      res.removeListener?.("finish", complete);
      res.removeListener?.("close", complete);
      const statusCode =
        Number.isInteger(res.statusCode) &&
        (res.statusCode ?? 0) >= 100 &&
        (res.statusCode ?? 0) <= 599
          ? res.statusCode!
          : 500;
      const level =
        statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
      internal.emitHttp({
        message: "HTTP request completed",
        level,
        correlationId,
        method:
          typeof req.method === "string" && /^[A-Z]+$/.test(req.method)
            ? req.method
            : "UNKNOWN",
        route: safeRoute(req),
        statusCode,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      });
    };
    res.once("finish", complete);
    res.once("close", complete);
    store.run({ correlationId }, next);
  };
  return {
    logger,
    middleware,
    getCorrelationId: () => store.getStore()?.correlationId,
  };
}
