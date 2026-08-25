# `@darkling/observability` package — journal

## Creation

Created as a leaf logging package backing the service bus and the Guide agent
loop. No root specification establishes logging; this is an implementation
concern. The user selected `consola` as the logging library and chose
(per the spec-authority question raised at implementation time) to defer the
decision on whether to formalise observability via the specification workflow
— "decide later". The package is therefore intentionally non-normative and
reversible: it adds diagnostic output only and alters no observable behaviour
of any governed subsystem.

## Decisions

### consola as the backing library

The user chose `consola` (v3.4.2). It is environment-agnostic (node and browser
builds, auto-detects), works in Web Workers, has leveled logging and tags, and
a stable programmatic API. We wrap it in a minimal `ConsolaInstance` interface
so consumers depend on a stable shape rather than consola's full evolving API;
this keeps the binding swappable in principle.

### Per-worker console sink (initial)

The user selected per-worker console (devtools) as the sink for now. The
service bus runs across Web Workers, each with its own console, so logs
appear per-worker. Aggregating logs over the service bus to a single main-thread
sink is a recorded follow-up, not provided here. A backend/remote sink is
likewise a follow-up.

### Closed tag set

`LOG_TAGS` is a closed set (`service-bus:broker`, `service-bus:host`,
`service-bus:client`, `guide:loop`, `guide:provider`). Keeping it closed makes
log origins predictable and greppable. New tags are added here when wiring a
new subsystem; consumers cannot invent arbitrary tags.

### Out-of-band only

Logs are for the operator/developer only. Agent-loop traces (turn-by-turn LLM
request/response, tool calls + results, budget before/after, carryover/
pressure, FINISHED/exhaustion) are diagnostic and do not alter the constrained
agent's "not directly observable" reasoning model — they are not surfaced to
the model or the User.

## Gaps and open questions

- **Bus-aggregated / remote sinks.** Not implemented; follow-up. If pursued,
  a bus sink would forward per-worker logs to a main-thread collector over the
  service bus. This would warrant revisiting whether the package needs a
  normative spec (since the service bus would then carry log traffic).
- **Specification workflow for observability.** Deferred. If the agent-loop
  telemetry or a remote sink becomes normative, an `observability.spec.md` (or
  a `policy-and-configuration.spec.md` section) may be warranted, especially
  given the constrained-agent "not directly observable" wording for reasoning.
- **LLM payload logging.** The agent-loop wiring logs the LLM request/response
  at debug/trace level (the request shape, not necessarily full prompt text).
  Full prompt/completion text logging is verbose and may leak content into
  logs; left at debug level and gated by the configured log level.