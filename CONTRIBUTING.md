# Contributing to Ops

## Before You Start

- Read [CONTEXT.md](./CONTEXT.md).
- Search the repository before adding a component, helper, type, constant,
  style, or icon. Reuse or extend an existing implementation where practical.
- Keep the change focused. Do not include unrelated refactors.
- Ask a maintainer before adding dependencies or changing architecture,
  database schemas, authentication, authorization, ingestion behavior, or the
  shared log contract.
- If documentation and implementation disagree, stop and ask a maintainer.

## Local Setup

- Use Node.js 24.19.0 and pnpm 11.24.0.
- On NixOS, run `nix-shell` to load the Node, pnpm, native build, and Chromium
  toolchain. Playwright uses the shell-provided Chromium binary and skips its
  browser download.
- Copy `.env.example` to `.env.local` and replace placeholder values.
- Start local PostgreSQL, Redis, and MongoDB services when the change needs
  them. `docker compose -f docker-compose.dev.yml up -d` provides the repository
  service definitions.
- Run the web application and worker together with `pnpm dev`, or separately
  with `pnpm dev:web` and `pnpm worker`. The web application uses
  `http://localhost:3005`.

## Code

- Use strict TypeScript and `import type` for type-only imports. Avoid `any`
  except at unavoidable external-library boundaries.
- Use `@/` for imports from `src/` and `@contracts/` for the frozen contract.
- Keep Route Handlers thin. Move database, storage, query, and policy logic into
  `src/lib/server/`.
- Use Zod for API query and input validation. Use the dependency-free frozen
  validator for `LogEventV1`.
- Name files and SCSS Modules in kebab-case, components and exported interfaces
  in PascalCase, hooks and functions in camelCase, hooks with a `use` prefix,
  and constants in SCREAMING_SNAKE_CASE. Framework filenames remain lowercase.
- Keep comments short and useful. Do not restate obvious code.

## Next.js and Server Code

- Use Server Components by default. Add `"use client"` only for focused
  interactivity or browser APIs.
- Keep data access, authentication, and authorization on the server.
- Every dashboard page, data API, export, diagnostic request, and SSE stream
  must independently require an eligible current-tenure operator, Head, or
  Admin. Only liveness and readiness are public.
- Do not rely on hidden UI controls or client-side validation for security.
- Return safe, human-readable errors to clients without exposing internal
  exception details or sensitive diagnostic context.

## Logging and Ingestion Safety

- Never log or persist request or response bodies, query values, headers,
  cookies, credentials, IP addresses, user agents, uploads, raw URLs, or
  identity data. Store route templates only.
- Reject unknown `LogEventV1` fields without coercion.
- Sanitize and size-limit diagnostics before enqueueing them.
- Insert PostgreSQL rows before acknowledging Redis entries. Publish live
  notifications only after the database write succeeds.
- Preserve idempotency by `event_id`.
- Dead letters may store only a payload hash, safe validation issues, a safe
  failure code, and delivery metadata.
- Do not add log-deletion APIs, process-control actions, or new sensitive data
  collection.

## UI and Styling

- Use a GitHub-inspired visual language: compact controls, restrained
  6px radii, semantic borders, system typography, and clear hover and focus
  states.
- Use SCSS Modules only. Do not add Tailwind, CSS-in-JS, global utility classes,
  or inline presentation styles.
- Use the shared variables in `src/app/app-shell.module.scss`; do not hardcode
  colors in component modules. Add every new color token to both themes.
- Keep dark mode as the default and preserve light-theme parity for every new
  surface and interaction.
- Keep top-level document pages within the shared 1440px content width. Retain
  narrower widths only where they improve readability or interaction.
- Keep responsive and `focus-visible` states in the owning SCSS Module.
- Dynamic data visualizations may use semantic elements and attributes such as
  `meter[value]`; avoid inline styles.
- Reuse Lucide icons instead of embedding SVG markup in components.

## Data and Configuration

- Use pagination and bounded queries for production data. Reuse repository
  helpers rather than creating parallel query or polling behavior.
- Store and exchange timestamps in UTC. Use IST for operator-facing log display
  unless a feature explicitly requires another timezone.
- Use `pnpm` only. Do not generate npm or Yarn lockfiles.
- Update `.env.example` and documentation when configuration changes.
- Never commit credentials, production secrets, local `.env*` files, or
  sensitive data.
- Document rollout and compatibility effects when changing schemas,
  environment variables, stream keys, consumer groups, retention behavior, or
  API responses. Provide a migration or safe fallback where needed.

## Contract Changes

- Treat `contracts/log-event-v1` as frozen unless a coordinated change has been
  approved across Ops and all registered projects.
- Contract changes require fixture agreement in Ops and every registered
  producer repository and a matching package-version and release-tag plan.
- Run `pnpm contract:check` for any approved contract work.

## Shared Logger Changes

- Keep `logger` compatible with the frozen contract without
  expanding the wire schema or collecting unsafe request context.
- Run `pnpm logger:check` for logger changes. The logger is released separately
  from the contract using `ops-logger-v<package-version>` tags.
- Do not migrate Ops' own logging to the shared logger; self-ingestion would be
  recursive.

## Documentation and Verification

- Update relevant documentation in the same change when setup, architecture,
  behavior, security, configuration, or contributor conventions change.
- Verify every changed behavior locally.
- After material changes, run:

  ```bash
  pnpm typecheck
  pnpm test
  pnpm lint
  pnpm build
  ```

- Run `pnpm format:check` before submitting when documentation or formatting has
  changed.

## Testing

- Name focused unit files `*.test.ts` and colocate them with production code.
- Use Vitest. Mock only credentials, sessions, external services, clocks, or
  other true boundaries.
- Tests must never require production data, production services, credentials,
  or internet access.
- Add regression coverage for changes to validation, authorization, ingestion,
  retention, queries, exports, and security-sensitive sanitization.

## Git and Pull Requests

- Normally branch from and target `main` unless a maintainer requests another
  branch.
- Follow the [Conventional Commits](https://www.conventionalcommits.org/)
  specification.
- Prefer descriptive branch names such as `feature/<short-name>`,
  `fix/<short-name>`, `docs/<short-name>`, or `refactor/<short-name>`.
- Pull requests should include:
  - a clear summary and motivation;
  - the local verification performed;
  - relevant screenshots for UI changes;
  - security, configuration, migration, and compatibility notes; and
  - linked issues when applicable.
