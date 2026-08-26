# Ops

Unified production observability for Coding Club IIT Guwahati.

## Getting Started

Use Node.js 24.19.0 and pnpm 11.24.0.

On NixOS, enter the repository development shell first:

```bash
nix-shell
```

```bash
pnpm install
cp .env.example .env.local
docker compose -f docker-compose.dev.yml up -d
pnpm dev
```

The web application runs at `http://localhost:3005`.
Replace all placeholder configuration in `.env.local` before using authentication or ingestion.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

## Contributing

Before contributing, read:

- [Contributing guidelines](./CONTRIBUTING.md)
- [Project context](./CONTEXT.md)
