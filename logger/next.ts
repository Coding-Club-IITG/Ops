import { context, trace, type Context } from "@opentelemetry/api";
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { isSafeRouteTemplate } from "@coding-club-iitg/ops-contract";
import {
  createOpsLogger,
  type OpsLogger,
  type OpsLoggerConfig,
} from "./index.js";
import { OPS_LOGGER_INTERNAL, type OpsLoggerInternal } from "./internal.js";

export type NextOpsLogger = {
  logger: OpsLogger;
  spanProcessor: SpanProcessor;
};

function stringAttribute(
  span: ReadableSpan,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = span.attributes[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function numberAttribute(
  span: ReadableSpan,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = span.attributes[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

/** Allow-listed Next.js server span processor. It never serializes the span itself. */
export class OpsNextSpanProcessor implements SpanProcessor {
  constructor(
    private readonly logger: OpsLogger,
    private readonly internal: OpsLoggerInternal = (
      logger as OpsLogger & { [OPS_LOGGER_INTERNAL]: OpsLoggerInternal }
    )[OPS_LOGGER_INTERNAL],
  ) {}

  onStart(_span: Span, _parentContext: Context): void {}

  onEnd(span: ReadableSpan): void {
    try {
      const spanType = stringAttribute(span, ["next.span_type"]);
      if (spanType !== "BaseServer.handleRequest") return;
      const route = stringAttribute(span, ["next.route", "http.route"]);
      if (!route?.startsWith("/api") || !isSafeRouteTemplate(route)) return;
      const method = stringAttribute(span, [
        "http.request.method",
        "http.method",
      ]);
      if (!method || !/^[A-Z]+$/.test(method)) return;
      const statusCode = numberAttribute(span, [
        "http.response.status_code",
        "http.status_code",
      ]);
      if (
        !statusCode ||
        !Number.isInteger(statusCode) ||
        statusCode < 100 ||
        statusCode > 599
      )
        return;
      const traceId = span.spanContext().traceId;
      if (!/^[a-f0-9]{32}$/i.test(traceId) || /^0+$/.test(traceId)) return;
      const durationMs = span.duration[0] * 1_000 + span.duration[1] / 1e6;
      if (!Number.isFinite(durationMs) || durationMs < 0) return;
      this.internal.emitHttp({
        message: "HTTP request completed",
        level:
          statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info",
        correlationId: traceId,
        method,
        route,
        statusCode,
        durationMs,
      });
    } catch {
      // Telemetry must never affect request handling
    }
  }

  async forceFlush(): Promise<void> {
    await this.logger.flush();
  }
  async shutdown(): Promise<void> {
    await this.logger.flush();
  }
}

/** Creates a logger correlated with the currently active OpenTelemetry trace */
export function createNextOpsLogger(config: OpsLoggerConfig): NextOpsLogger {
  const logger = createOpsLogger({
    ...config,
    getCorrelationId: () => {
      const traceId = trace.getSpan(context.active())?.spanContext().traceId;
      return traceId && !/^0+$/.test(traceId) ? traceId : undefined;
    },
  });
  return { logger, spanProcessor: new OpsNextSpanProcessor(logger) };
}
