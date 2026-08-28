# `@coding-club-iitg/ops-logger`

Canonical, safe logger for Coding Club IITG projects.
Node.js 18+ is required.
The package is ESM and includes TypeScript declarations - plain JavaScript consumers can import it normally.

```ts
import { createOpsLogger } from "@coding-club-iitg/ops-logger";

const logger = createOpsLogger({
  project: "ccw",
  service: "ccw-web",
  ingestionUrl: process.env.OPS_INGESTION_URL!,
  secret: process.env.OPS_INGESTION_SECRET!,
  enabled: process.env.NODE_ENV === "production",
});

logger.error("Mess assignment failed", {
  error,
  attributes: {
    operation: "assign-mess",
    dependency: "mongodb",
    retryable: false,
  },
});

logger.metric("course.view", {
  dimensions: { courseCode: "CS101", studentYear: 2 },
});
```

Metrics default to a value of `1`, are delivered to the sibling metrics ingestion endpoint independently of log export levels,
and are not printed to the application console.
Set `metricIngestionUrl` only when the endpoints are not siblings.

Every level is written as safe structured JSON to the console.
`warn`, `error`, and `fatal` are exported by default (set `exportLevels` explicitly to change this).
Delivery has a 2 second default timeout, at most 8 in-flight requests, no retries, and never throws into application code.
Inspect `deliveryStatus()` for pending/dropped counts and `await logger.flush()` during graceful shutdown.

Only contract attributes are accepted.
Do not put request bodies, headers, query values, raw URLs, cookies, IP addresses, user agents, uploads, or identity data in messages or attributes.
Worker/job correlation remains explicit through `details.correlationId`.

## Express

```ts
import { createExpressOpsLogger } from "@coding-club-iitg/ops-logger/express";

const { logger, middleware } = createExpressOpsLogger(config);
app.use(middleware);
```

The middleware generates a UUID locally for every request, uses `AsyncLocalStorage`, and emits one completion event.
It ignores inbound correlation headers and raw URLs.
Register it after Express has resolved route templates if you want matched templates; unmatched requests use the fixed `unmatched` fallback.

## Next.js

Next.js 16 with OpenTelemetry 2.x is the initially supported combination.
Install `@opentelemetry/api` and `@opentelemetry/sdk-trace-base`, then register the returned processor with the Node SDK:

```ts
import { createNextOpsLogger } from "@coding-club-iitg/ops-logger/next";
const { logger, spanProcessor } = createNextOpsLogger(config);
```

Only completed `/api` request spans with allow-listed scalar attributes are mapped.
Application logs use the active trace ID.
Full spans and framework request objects are never serialized.
