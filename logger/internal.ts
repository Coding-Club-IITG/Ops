import type { LogEventLevel } from "@coding-club-iitg/ops-contract";

export const OPS_LOGGER_INTERNAL = Symbol.for(
  "@coding-club-iitg/ops-logger/internal",
);

export type OpsLoggerInternal = {
  emitHttp(input: {
    message: string;
    level: LogEventLevel;
    correlationId: string;
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
  }): void;
};
