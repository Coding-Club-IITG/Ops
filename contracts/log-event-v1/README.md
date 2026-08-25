# LogEventV1

This directory is the frozen, application-independent telemetry wire contract.

Projects and their services are registered in `project-registry.ts`.
Service IDs must be globally unique.

The `fixtures/valid` files are shared acceptance inputs.
Every producer must emit these shapes exactly, and every consumer must accept them.
The `fixtures/invalid` files document payloads that must be rejected or sent to
the ingestion dead-letter store.

V1 deliberately excludes bodies, raw URLs, query values, headers, cookies,
credentials, IP addresses, user agents, uploaded content, identity data, stack
traces, and arbitrary metadata.
`attributes` is restricted to the exported allowlist and scalar values.
Route parameters must be represented by framework template syntax.
