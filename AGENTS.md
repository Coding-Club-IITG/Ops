# AGENTS.md - Ops Development Guide

## Project overview

Ops is one unified Next.js 16 / React 19 application at the repository root. Next.js Route Handlers provide the web API, and `src/worker/index.ts` runs as the separate `ops-worker` process from the same package.

- PostgreSQL: `LogEventV1` storage, full-text search, and ingestion dead letters
- Redis: durable log ingestion stream and post-commit live notifications
- MongoDB/Atlas: Better Auth, operator data, audit events, and time-series host/PM2 metrics
- Styling: SCSS Modules only; do not add Tailwind, CSS-in-JS, or global utility classes

## Commands

```bash
pnpm install
pnpm dev          # Next.js on http://localhost:3005
pnpm worker       # Redis ingestion + metrics + retention
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Node 24.19.0 and pnpm 11.24.0 are required. Copy `.env.example` to `.env.local` for local work.

## Structure

```text
src/
├── app/                 # pages and Route Handlers
├── components/          # shared React components + colocated SCSS Modules
├── features/ops/        # overview, logs, and metrics UI
├── lib/server/          # PostgreSQL, Redis, Mongo, authz, repositories
├── types/               # client/API view types
└── worker/              # independent ops-worker entrypoint
contracts/log-event-v1/  # frozen cross-repository contract and fixtures
```

## TypeScript and imports

- Strict TypeScript is required.
- Use `import type` for type-only imports.
- `@/*` maps to `src/*`; `@contracts/*` maps to `contracts/*`.
- Keep Route Handlers thin and move storage/query logic into `src/lib/server/`.
- Use Zod for API query/input validation and the frozen dependency-free validator for `LogEventV1`.

## Styling

- Every component or layout owns a kebab-case `*.module.scss` file.
- Use CSS variables from `app-shell.module.scss` for shared color tokens.
- Use module class names from `styles`; do not use unscoped class strings.
- Dynamic data visualizations may use semantic HTML attributes such as `meter[value]`; avoid inline styles.
- Keep responsive and focus-visible states in the owning SCSS Module.

## Security invariants

- Never capture or store request/response bodies, query values, headers, cookies, credentials, IPs, user agents, uploads, raw URLs, or identity data in logs.
- Store route templates only.
- Reject unknown `LogEventV1` fields without coercion.
- Insert PostgreSQL rows before acknowledging Redis entries.
- Preserve idempotency by `event_id`; dead letters store only a payload hash and safe validation issues.
- Every data API and SSE stream requires an eligible current-tenure operator, Head, or Admin. Liveness/readiness are the only public operational endpoints.
- Do not add log-deletion APIs or process-control actions.

## Naming

- Files and SCSS Modules: kebab-case
- Components and exported interfaces: PascalCase
- Hooks/functions: camelCase; hooks begin with `use`
- Constants: SCREAMING_SNAKE_CASE

## Verification

Run type checking, tests, lint, and the production build after material changes. Contract changes require review and fixture agreement across Ops, CCW, and HABit; do not change the contract independently.
