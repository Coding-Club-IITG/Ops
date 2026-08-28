# Ops Project Context

> Keep this document current. Update it in the same change whenever its product,
> architecture, security, or deployment information becomes outdated.

## Product

Ops is Coding Club IIT Guwahati's authenticated, production observability application.
It gives eligible operators a single place to review service health, search structured logs,
inspect sanitized error diagnostics, export log results, and monitor host and PM2 process metrics.

## Major Features

- **Overview:** Production service state, recent error volume, event totals, and
  ingestion health.
- **Log explorer:** URL-restorable advanced filtering, adaptive stacked volume
  history, configurable safe-field columns, team saved views, pagination, live
  updates over server-sent events, event detail, and CSV export.
- **Safe diagnostics:** Sanitized stack and cause details,
  with fingerprint and redaction metadata visible in the log explorer.
- **Analytics:** Dynamic project-metric explorer whose catalog is discovered
  from incoming events.
- **Infrastructure:** Host CPU, memory, disk, network, PM2, and admin-only OS
  telemetry.
- **Services:** URL-restorable golden-signal analytics for each registered
  service, including HTTP traffic, 5xx errors, application errors, latency
  percentiles, and PM2 saturation.
- **Correlation timelines:** Chronological retained events that share an exact
  correlation ID, exposed from the event drawer with a 500-event cap.
- **Alerting:** Durable service and host rules with global defaults,
  per-service overrides, sustained evaluation, service-wide notification
  mutes, alert history, and Discord firing, reminder, and recovery messages.
- **Audit:** Administrator-only browsing of immutable operator actions with
  date, action, and actor filters.
- **Access management:** Administrator-managed viewer and admin grants.
- **Operational health:** Public liveness and readiness endpoints for deployment
  infrastructure.

## Stack

- Next.js 16 App Router, React 19, and strict TypeScript
- SCSS Modules and a shared GitHub-derived light/dark color system
- PostgreSQL for `LogEventV1` and `MetricEventV1` events, dynamic metric
  queries, full-text log search, sanitized diagnostics, ingestion dead letters,
  alert rules, alert state, and the notification outbox
- Redis Streams for durable ingestion and Redis Pub/Sub for post-commit live
  notifications
- MongoDB/Atlas for Better Auth, operator grants, audit events, and time-series
  host and PM2 metrics
- Microsoft authentication through Better Auth
- pnpm for package management and PM2 for the production processes

## Repository Map

- `src/app/(dashboard)`: authenticated overview, logs, services, project
  analytics, infrastructure, audit, and operator pages
- `src/app/api`: authenticated data APIs, log ingestion, authentication, and
  public health Route Handlers
- `src/components`: shared React components and their SCSS Modules
- `src/features`: observability views, shared feature components, and focused
  client-side polling logic
- `src/lib/server`: database connections, authorization, repositories,
  ingestion safety, audit logic, and metric collection
- `src/types`: client and API view types
- `src/worker`: standalone ingestion, metrics, and retention worker
- `contract`: dependency-free cross-repository log & metric event contracts,
  project registry, package, and log fixtures
- `logger`: versioned producer implementation with core, Express, and Next.js entrypoints
- `ecosystem.config.js`: PM2 definitions for `ops-web` and `ops-worker`

## Runtime Boundaries

- Server Components are the default rendering boundary. Client Components are
  limited to focused interactions such as polling, filters, authentication, and
  theme selection.
- Route Handlers authenticate, authorize, and validate untrusted input. Storage
  and query logic belongs under `src/lib/server`, not in route files.
- The Next.js process serves the interface and API. The separate `ops-worker`
  consumes the Redis stream, writes accepted events to PostgreSQL, publishes
  live notifications, samples metrics every 30 seconds, and applies retention.
- The ingestion endpoint authenticates with a bearer secret, limits payloads to
  64 KB, strictly validates the envelope, sanitizes diagnostic text, and writes
  accepted messages to Redis.
- The worker validates `LogEventV1` again, inserts PostgreSQL rows before
  acknowledging Redis entries, and publishes live notifications only after a
  new row is committed. `event_id` provides idempotency.
- The worker evaluates alert rules every 30 seconds under a PostgreSQL advisory
  lock. Alert transitions and Discord outbox entries commit atomically;
  delivery failures never block evaluation and are retried with backoff.
- Permanently invalid messages are retried before dead-lettering. Dead letters
  contain only a payload hash, a safe failure code, safe validation issues, and
  delivery metadata.
- Host metrics contain host-level measurements and configured PM2 process data.
  Project metric names and scalar dimensions are discovered at runtime.
  Ops exposes no process-control action.
- Host health is evaluated server-side from fresh metrics with shared CPU,
  memory, and disk thresholds so Overview and Infrastructure cannot disagree.
- Audit events preserve immutable operator IDs and snapshot the operator email
  when it is available.
- Theme selection is dark by default and is persisted in a cookie so the server
  renders the selected light or dark theme without a hydration mismatch.

## Authentication and Access

Authentication uses Better Auth with Microsoft accounts. Every dashboard page,
data API, export, diagnostic endpoint, and SSE stream requires an eligible
operator. Liveness and readiness are the only public operational endpoints.

Eligibility requires an enabled, explicit Ops grant in MongoDB. Provision the
initial administrator with `OPS_SEED_ADMIN_EMAIL=... pnpm seed`; the command is
idempotent and also seeds the default team log views.
Resolved operators receive either a `viewer` or `admin` Ops role.

## Logging and Data Safety

Ops must never capture request or response bodies, query values, headers,
cookies, credentials, user agents, or uploads in application logs. HTTP events
store route templates only. Sanitized error diagnostics preserve useful identity,
network, URL, request-path, and complete source-path context while redacting
credentials, authorization values, cookies, API keys, sessions, tokens, and
secrets. Metric dimensions accept bounded scalar application context but reject
credential field names and recognizable authentication tokens.

Unknown `LogEventV1` fields are rejected without coercion. Error diagnostics are
sanitized and size-limited before entering the stream. Do not add log-deletion
APIs, process-control actions, or broader diagnostic collection.

## Cross-Repository Contract

`contract` is shared by Ops and registered projects. It is intentionally
dependency-free and keeps published root imports compatible.
Contract changes require coordinated producer/consumer review.
The package is published only from tags matching
`ops-contract-v<package-version>`.

`logger` implements that wire contract. Its releases use independent
`ops-logger-v<package-version>` tags.

## Branches and Deployment

The default branch is `main`. Production runs the built Next.js application as
`ops-web` and the standalone worker as `ops-worker` through
`ecosystem.config.js`. The web process listens on port 3005 by default.

If this document and the implementation disagree, stop and ask a maintainer
which behavior is intended before proceeding.
