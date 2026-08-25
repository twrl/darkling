# `@darkling/observability` package

## Purpose and scope

This specification defines the `@darkling/observability` package: a leveled,
tagged logging facility for development and diagnostics, backed by `consola`.

It governs:

- the package's public API surface — `createLogger`, `configureLogging`, the
  `LOG_TAGS` set, the `ConsolaInstance` interface, and the re-exported
  `ConsolaLogLevel`;
- the logging contract — out-of-band, per-worker console output, leveled,
  tagged by subsystem;
- the package's dependencies and build configuration.

It is explicitly out of scope for this specification to define:

- any normative observability requirement for Darkling — no root specification
  establishes logging or telemetry. This package is an implementation concern;
  it exists to give the service bus and the agentic loop a consistent logging
  surface. It may be formalised by a future root specification;
- a bus-aggregated or backend/remote log sink — the initial implementation logs
  per-worker to the console; aggregation is a follow-up;
- any behaviour visible to the Guide or the Visitor. Logs are out-of-band for
  the operator/developer. Agent-loop traces are diagnostic only and do not
  alter the constrained agent's "not directly observable" reasoning model.

## Relationship to the root specifications

No root specification governs logging. This package is introduced as an
implementation decision recorded in the relevant journals. It must not alter
the observable behaviour of any subsystem defined by a root specification; it
only emits diagnostic output. Where it is wired into the service bus
(`@darkling/service-bus`) and the Guide agent loop (`@darkling/guide`), the
wiring is additive logging only — no control-flow or behavioural change.

## Public API surface

The package exports from a single entry point (`./src/index.ts`, mapped as `.`):

- `createLogger(tag: LogTag): ConsolaInstance` — create a tagged logger for a
  subsystem. Tags are drawn from the closed `LOG_TAGS` set so log origins are
  predictable.
- `configureLogging(options?: LoggingOptions): void` — set the global log
  level (and optionally select consola options). Call once at startup.
- `LOG_TAGS` / `LogTag` — the closed set of subsystem tags.
- `ConsolaInstance` — the minimal logger interface consumers depend on.
- `ConsolaLogLevel` — re-exported level constants.

## Logging contract

- Logs are out-of-band: they are for the operator/developer and are not visible
  to the Guide or the Visitor.
- Each logger is tagged with its subsystem; log lines carry the tag so
  per-worker console output is attributable.
- The level is configurable globally via `configureLogging`; the default is
  `info`.
- The default reporter is consola's, which writes to the surrounding
  context's console. In the service bus's Web Worker topology each worker has
  its own console, so logs appear per-worker under devtools.

## Dependencies

- `consola` — the logging library.

The package has no dependency on the service bus, the Guide, or any other
Darkling package; it is a leaf dependency that others import.