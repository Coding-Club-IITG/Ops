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
- **Safe diagnostics:** Sanitized stack and cause details for administrators,
  with fingerprint and redaction metadata visible in the log explorer.
- **Metrics:** Historical host CPU, memory, disk, and network telemetry together
  with allow-listed PM2 process state and admin-only partition, interface, and
  safe OS-process summaries.
- **Access management:** Administrator-managed viewer and admin grants.
- **Operational health:** Public liveness and readiness endpoints for deployment
  infrastructure.

## Stack

- Next.js 16 App Router, React 19, and strict TypeScript
- SCSS Modules and a shared GitHub-derived light/dark color system
- PostgreSQL for `LogEventV1` events, full-text search, sanitized diagnostics,
  and ingestion dead letters
- Redis Streams for durable ingestion and Redis Pub/Sub for post-commit live
  notifications
- MongoDB/Atlas for Better Auth, operator grants, audit events, and time-series
  host and PM2 metrics
- Microsoft authentication through Better Auth
- pnpm for package management and PM2 for the production processes

## Repository Map

- `src/app/(dashboard)`: authenticated overview, logs, metrics, and operator
  pages
- `src/app/api`: authenticated data APIs, log ingestion, authentication, and
  public health Route Handlers
- `src/components`: shared React components and their SCSS Modules
- `src/features/ops`: observability views and focused client-side polling logic
- `src/lib/server`: database connections, authorization, repositories,
  ingestion safety, audit logic, and metric collection
- `src/types`: client and API view types
- `src/worker`: standalone ingestion, metrics, and retention worker
- `contracts/log-event-v1`: frozen dependency-free cross-repository log event
  contract, package, and fixtures
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
- Permanently invalid messages are retried before dead-lettering. Dead letters
  contain only a payload hash, a safe failure code, safe validation issues, and
  delivery metadata.
- Metrics contain host-level measurements and configured PM2 process data. Ops
  exposes no process-control action.
- Theme selection is dark by default and is persisted in a cookie so the server
  renders the selected light or dark theme without a hydration mismatch.

## Authentication and Access

Authentication uses Better Auth with Microsoft accounts. Every dashboard page,
data API, export, diagnostic endpoint, and SSE stream requires an eligible
operator. Liveness and readiness are the only public operational endpoints.

Eligibility requires an enabled, explicit Ops grant in MongoDB. Provision the
initial administrator with `OPS_SEED_ADMIN_EMAIL=... pnpm seed`; the command is
idempotent and also seeds the default team log views.

Resolved operators receive either a `viewer` or `admin` Ops role. Administrators
can manage grants and view available sanitized diagnostics. Authorization must
be enforced independently on the server; hidden UI controls are not a security
boundary.

## Logging and Data Safety

Ops must never capture or store request or response bodies, query values,
headers, cookies, credentials, IP addresses, user agents, uploads, raw URLs, or
identity data in application logs. HTTP events store route templates only.

Unknown `LogEventV1` fields are rejected without coercion. Error diagnostics are
sanitized and size-limited before entering the stream. Do not add log-deletion
APIs, process-control actions, or broader diagnostic collection.

## Cross-Repository Contract

`contracts/log-event-v1` is shared by Ops, CCW, and HABit. It is intentionally
dependency-free and must remain compatible across producers and this consumer.
Do not change the contract independently: contract changes require review and
fixture agreement in all three repositories. The package is published only from
tags matching `ops-contract-v<package-version>`.

## Branches and Deployment

The default branch is `main`. Production runs the built Next.js application as
`ops-web` and the standalone worker as `ops-worker` through
`ecosystem.config.js`. The web process listens on port 3005 by default.

If this document and the implementation disagree, stop and ask a maintainer
which behavior is intended before proceeding.
