# Journal: `@darkling/guide` package

This journal records the development of the `@darkling/guide` package — the implementation of [constrained-agent.spec.md](../../specs/constrained-agent.spec.md), the budget policy of [event-system.spec.md](../../specs/event-system.spec.md), the `safety_consult` tool of [agent-safety.spec.md](../../specs/agent-safety.spec.md), and the LLM provider abstraction of [usage-and-deployment.spec.md](../../specs/usage-and-deployment.spec.md) as defined by [package.spec.md](./package.spec.md). It is non-normative; the specifications take precedence.

## Origin

Created in response to a request to "implement the agentic logic for the Guide." Established via the spec-anchored workflow: the applicable root specifications were already established, so this is an implementation package, not a new specification. The package spec and this journal were created per the repo pattern (one package per spec area, with a colocated `package.spec.md` and `package.journal.md`).

## Scope decisions

Through dialogue with the user, the following scope decisions were made:

- **One package, the constrained-agent area.** The package is named `@darkling/guide` (after the actor) rather than `@darkling/constrained-agent` (after the spec), matching the repo's idiom. It conforms primarily to `constrained-agent.spec.md` and secondarily to the budget policy of `event-system.spec.md`, the `safety_consult` of `agent-safety.spec.md`, and the LLM provider abstraction of `usage-and-deployment.spec.md`.
- **Injectable tool registry.** The four tool categories are enforced by a `ToolRegistry`; the two agent-self tools defined by spec (`update_working_memory`, `safety_consult`) are provided by this package. The other three categories (avatar, UI control, knowledge base access) are registered by the host, since their domain specs do not yet exist. This package provides the dispatch + category enforcement + budget gating, with stub-able tools so the loop is testable now. This avoids inventing behaviour not established by spec for the missing categories.
- **LLM provider: HTTP backend-proxy client.** The user chose an HTTP client calling the backend LLM proxy over a `ScriptedLlmProvider` for tests. The `LlmProvider` interface is provider-agnostic; `HttpLlmProvider` calls the backend proxy, and `ScriptedLlmProvider` returns queued outputs for tests. The backend holds the API key; the Service Worker attaches the token, so the client makes an ordinary `fetch`.

## Key decisions and rationale

### The loop consumes a flushed queue; it does not own the trigger

[Event system](../../specs/event-system.spec.md#interaction-triggering) owns the event queue, the per-event roll, and the trigger. [Constrained agent](../../specs/constrained-agent.spec.md#agentic-model) defines that when an interaction is triggered, the current event queue is sent to the model. The `AgentLoop.runInteraction` therefore takes the flushed event queue as an argument and runs one interaction; it does not own the queue, the roll, or the trigger. The host (the frontend) is responsible for queueing events, rolling for flush, and calling `runInteraction` when a flush occurs. This keeps the boundary between the event system (trigger) and the constrained agent (interaction) clean, as anticipated by the constrained-agent journal.

### Working memory owned by the loop, accessed via the dispatch context

The initial design had the `update_working_memory` handler close over a working-memory holder injected at registry-build time. This decoupled the handler from the loop but meant the loop's `this.workingMemory` was not the value being updated, so the updated value never appeared in the next interaction's status object. Resolved by adding a `workingMemory` accessor to `ToolDispatchContext`, wired by the loop to its own `this.workingMemory` holder. The handler reads and replaces via the context, so the replacement takes effect for the next interaction, as required by [Working memory](../../specs/constrained-agent.spec.md#working-memory). The `createUpdateWorkingMemoryHandler` factory now takes no arguments; the same handler works across loop instances.

### Budget-blocked calls vs. budget-exhausted turns

[Exhaustion](../../specs/constrained-agent.spec.md#exhaustion) says no further tool calls are dispatched after the budget is exhausted. There are two cases: (a) a turn arrives when the budget is already exhausted — the loop breaks before dispatching, and those calls are not "undispatched" in the spec sense (they were never attempted); (b) a call within a turn would exceed the max overspend — the loop marks it undispatched and carries it to the next interaction. The implementation distinguishes these: `budget.exhausted` is checked at the top of the turn (case a, the interaction ends), and `canDispatch(cost)` is checked per-call within a turn (case b, the call becomes undispatched). This matches the spec: undispatched tool calls are calls that "could not be dispatched," and a turn skipped entirely due to prior exhaustion is not a per-call dispatch attempt.

### Parallel dispatch via Promise.all

[Turns](../../specs/constrained-agent.spec.md#turns) requires tool calls to be dispatched in parallel where possible. The loop dispatches all dispatchable calls in a turn via `Promise.all`, observing their results after all have settled. A test asserts both handlers start before either ends, confirming parallelism. The service bus's per-host workers provide the actual concurrency in production; within the loop, `Promise.all` provides the parallelism over the (potentially worker-backed) handler promises.

### FINISHED as an abstraction, not a literal

[FINISHED](../../specs/constrained-agent.spec.md#finished) is an abstraction over the provider's completion signal. The `LlmProvider.turn` returns a `TurnOutput` with `finished: true` when the model returned FINISHED, and `toolCalls` otherwise. The `HttpLlmProvider` maps the backend proxy's response (`finished` boolean) to this; the backend is responsible for mapping the underlying provider's signal (e.g. `finish_reason: "stop"`) to the proxy's `finished` field. This keeps the loop provider-agnostic.

### Budget policy mechanics co-located with the loop

The budget policy is owned by [Event system](../../specs/event-system.spec.md#budget-policy), but the mechanics (the `BudgetTracker` and `InteractionBudget` bookkeeping) are implemented here because they are the enforcement substrate the loop needs. The policy values are parameters (`BudgetPolicy`), provided to the loop at construction, per [Policy and configuration](../../specs/policy-and-configuration.spec.md). This mirrors the knowledge-base package's relationship to its retrieval policy: the spec owns the parameter table; the package owns the mechanism and a default.

### Carryover decay is per-interaction-inactivity, not time-based

[Carryover](../../specs/event-system.spec.md#carryover) requires decay toward zero over a period of inactivity. The spec leaves the decay function as a policy parameter. The implementation uses a per-interaction counter: the host reports the number of interactions that have passed since the previous one, and the tracker applies decay when that exceeds the threshold. This is a simple, deterministic approximation of time-based decay that fits the interaction-driven model. A real time-based decay could be substituted by changing `reportInteraction`'s inactivity argument; the policy parameter (`carryoverDecay`, `carryoverDecayThreshold`) is unchanged.

### `safety_consult` via a host-injected consultant

[Agent safety](../../specs/agent-safety.spec.md#the-safety-consultant) defines the consultant as a separate LLM agent invoked through the service bus. The package defines a `SafetyConsultant` interface and a handler that delegates to it; the host injects the consultant (e.g. a service-bus proxy to the backend's consultant service). This keeps the package provider-agnostic and avoids a hard dependency on the service bus for the tool itself — the loop dispatches the tool through the registry like any other, and the consultant call happens inside the handler. If the consultant is unavailable, the call rejects and becomes undispatched, and the Guide falls back on its prompt-level safety guidance, as noted in the agent-safety journal.

### Service-bus integration follows the knowledge-base pattern

The package exposes a `guide` service with a `runInteraction` function, following the knowledge-base package's declaration/implementation split: `service-declaration.ts` exports the `declaration` (with a lazy `implementationLoader`), and `service-implementation.ts` exports the `GuideService`. The host instantiates the service with a `HostContext` carrying `GuideServiceOptions` (provider, registry, budget policy). The loop runs in the Guide's dedicated Web Worker, as defined by [Runtime topology](../../specs/usage-and-deployment.spec.md#runtime-topology); exposing it as a bus service lets the host trigger interactions over the bus.

## Revision: probabilistic overspend and min(spent, remaining) carryover

The budget implementation was rewritten to conform to the revised [Event system](../../specs/event-system.spec.md#budget-policy) budget policy (the spec change is recorded in `specs/event-system.journal.md`). The earlier `maxOverspend` / `maxCarryover` / `minCarryover` / `carryoverDecay` / `carryoverDecayThreshold` policy parameters and the deterministic `canDispatch(cost)` bound are gone, replaced by:

- **Carryover** `min(spent, remaining)` in `BudgetTracker.reportInteraction`, peaking at half-budget, zero on decline/full-spend, negative on overspend. No caps, no decay.
- **Pressure** — a new non-negative, decaying accumulator in `BudgetTracker`, updated as `max(0, floor(p/2) - min(0, remaining))`.
- **Probabilistic overspend gate** in `InteractionBudget.attemptDispatch`: a call within budget is always `'ok'`; an overspend rolls `overspendProbability(pressure, proposedOverspend, base) = sigmoid(1 - (floor(pressure/2) + proposedOverspend) / base)` against an injectable `RandomSource`. A failed roll returns `'denied'`, marks the budget exhausted, and the loop makes the call undispatched with reason `overspend-denied` and ends the interaction via the exhaustion path.

### Key decisions and rationale

#### `attemptDispatch` replaces `canDispatch` + `consume`

The old API split the dispatch decision (`canDispatch`) from recording (`consume`), with `canDispatch` a pure boolean. The probabilistic gate makes the decision a roll with a side effect (marking exhausted on denial), so the two are fused into `attemptDispatch(cost): 'ok' | 'denied'`, with `consume` called only after `'ok'`. This keeps the gate's state transition (denial marks exhaustion) atomic with the decision and matches the spec's "a failed roll makes the call undispatched and ends the interaction."

#### Exhaustion now means "a dispatch was denied"

With no hard maximum, `InteractionBudget.exhausted` is no longer "consumed reached budget + maxOverspend"; it's "a gate roll failed this interaction." The loop's existing `if (budget.exhausted) break` after dispatch handles this: a denied call sets `exhausted`, the turn's undispatched call is recorded, and the loop breaks. A call that fits within budget never sets exhausted even at full spend (the next call would be an overspend and roll the gate).

#### Injectable randomness

`BudgetPolicy.random` is an optional `RandomSource` (defaulting to `Math.random`); tests inject a `scriptedRandom` with a fixed roll sequence so the gate is deterministic. The spec requires an injectable randomness source for testability; the loop falls back to a `Math.random` `DEFAULT_RANDOM` when the policy omits one.

#### `reportInteraction` dropped the inactivity argument

The old `reportInteraction(budget, consumed, interactionsIdle)` carried an inactivity count for carryover decay. With carryover decay removed (debt is repaid via the negative carryover reducing the next budget, and pressure halving is the only decay), the signature is now `reportInteraction(budget, consumed)`. `markInteraction` is gone.

#### Observability getters

`AgentLoop` now exposes `currentCarryover` and `currentPressure` (delegating to the tracker) so tests and hosts can observe cross-interaction budget state without reaching into private fields.

## Gaps and ambiguities

- **Other tool categories' tools.** The avatar-and-user-interaction, ui-control, and knowledge-base-access categories have no spec-defined tools yet. The package provides the registry and dispatch; the host registers concrete tools. When those domain specs are established, their packages should provide tool declarations/handlers (or service-bus-backed handlers) to register here.
- **Status object additional fields.** [Interaction input](../../specs/constrained-agent.spec.md#interaction-input) permits additional status fields. The current `InteractionStatus` includes budget, working memory, and undispatched; extensions (e.g. current document, attention state) would be added as the UI spec is established.
- **Budget policy values.** `DEFAULT_BUDGET_POLICY` is a conservative placeholder. Production values are configuration, per [Policy and configuration](../../specs/policy-and-configuration.spec.md); the host overrides them.
- **Tool cost visibility in the system prompt.** The package sends tool declarations (with costs) to the provider in the `LlmTurnRequest`; how the provider turns those into a system prompt is the backend's concern (the proxy constructs the prompt). The package provides the data; the prompt construction is out of scope here.
- **Max turns safety bound.** The loop has a `maxTurns` safety bound (default 20) beyond the budget, to prevent runaway interactions when tool calls are free. This is an implementation safety, not a spec requirement; the budget is the primary bound.
- **Carryover shape vs decay.** The carryover is now `min(spent, remaining)` (no decay parameter); debt decay is handled by pressure's per-interaction halving, not a carryover decay. Whether the half-budget peak and the loss of quiet-accumulation are the desired long-term dynamics should be revisited once the Guide's behaviour is observable.
- **Conflict resolution for UI-control tools.** [Three-way interaction](../../specs/three-way-interaction.spec.md#conflict-resolution) requires UI-control tool calls to yield to User actions. This is the responsibility of the UI-control tools themselves (registered by the host); the loop dispatches them and reports failures as undispatched, but does not mediate conflicts. The UI-control tools must implement User precedence in their handlers.

## OpenRouter upstream provider

Added an `OpenRouterLlmProvider` implementing `LlmProvider` against the OpenRouter chat completions API, for backend use. The user observed that using the same `LlmProvider` abstraction on the backend for the upstream provider keeps the abstraction symmetric: the frontend's `HttpLlmProvider` calls the backend, and the backend's `OpenRouterLlmProvider` implements the same interface against the upstream model API. This matches [LLM provider abstraction](../../specs/usage-and-deployment.spec.md#llm-provider-abstraction), which requires the provider to be a swappable configuration choice.

### Scope decisions

Through dialogue with the user, the following scope decisions were made:

- **Location: in `@darkling/guide`.** The provider lives alongside the `LlmProvider` interface it implements, keeping all provider implementations with the abstraction. The backend imports it. The alternative (a separate `@darkling/openrouter-provider` package) was rejected as adding a package for a single class; implementing directly in `apps/backend` was rejected because it would separate the implementation from the interface and prevent reuse/testing in the package.
- **Non-streaming only.** The agent loop awaits the full turn output per turn (tool calls or FINISHED), so streaming offers no behavioural benefit for the loop's turn-at-a-time model. Streaming (SSE) deferred until the loop or UI can exploit incremental delivery.
- **Tool schemas via Zod → JSON Schema.** Each tool's `params` Zod schema is converted to a JSON Schema via `z.toJSONSchema` (Zod v4) for OpenRouter's `function.parameters`. This reuses the schemas already in `ToolDeclaration` and avoids a separate hand-written JSON Schema field.

### Key decisions and rationale

#### FINISHED mapping

[FINISHED](../../specs/constrained-agent.spec.md#finished) is an abstraction over the provider's completion signal. OpenRouter normalises `finish_reason` to `tool_calls`, `stop`, `length`, `content_filter`, or `error`. The provider maps `tool_calls` to tool calls and _every other_ finish reason to FINISHED. This is deliberate: `stop` is the normal completion (the Guide declines or has finished responding), but `length`, `content_filter`, and `error` also end the interaction — the loop cannot usefully continue a turn that the upstream ended for those reasons. A response with `tool_calls` but a non-`tool_calls` finish reason is treated as FINISHED (no tool calls accepted), guarding against providers that populate `tool_calls` loosely.

#### Interaction input rendered as messages

OpenRouter's API is chat-completions-shaped (a `messages` array), while the constrained-agent model is status-shaped (an event queue + status object). The provider bridges this by rendering the status object (budget, working memory, undispatched calls) as a `system` message and the event queue as a `user` message. This is an implementation detail of the provider; the spec defines the interaction input, not its chat-completions rendering. The system message also restates the tool-call discipline (no free text; issue tool calls or FINISHED), reinforcing the constrained-agent constraints at the prompt level.

#### Tool results as assistant + tool messages

OpenRouter (like OpenAI) requires `tool` messages to follow an assistant message whose `tool_calls` reference the same ids. The loop represents the previous turn as `TurnResultEntry`s, not as a retained assistant message, so the provider synthesises the assistant message from the results (with empty `arguments`) before the `tool` messages. This is a faithful bridge: the assistant "said" it would call these tools (the ids match), and the `tool` messages report the outcomes.

#### Malformed tool arguments

OpenRouter returns tool `arguments` as a JSON string. If a model returns malformed JSON, the provider emits the raw string as the params rather than crashing; the tool registry's Zod validation then rejects it, and the call becomes undispatched. This keeps a single malformed call from ending the whole turn.

#### API key held server-side

The provider is for backend use only. The API key is passed to the constructor and sent as a `Bearer` header; it must never be sent to the frontend, as required by [LLM provider abstraction](../../specs/usage-and-deployment.spec.md#llm-provider-abstraction). There is no guard preventing frontend import beyond the package's documentation; the backend is the only consumer that should instantiate it.

### Gaps and ambiguities (OpenRouter)

- **Streaming.** Not implemented; deferred until the loop or UI can exploit incremental delivery.
- **Prompt construction.** The system message is a simple rendering of the status object. A real Guide prompt (personality, annotations, safety encouragement) is the backend's concern and will be developed with the annotations/UI specs. The provider provides the constrained-agent framing; the backend composes the full prompt around it.
- **Token usage and cost.** The provider does not surface `usage`/`cost` from the response. The backend's cost and abuse controls (per [Usage and deployment](../../specs/usage-and-deployment.spec.md#cost-and-abuse-controls)) will need token/cost data; a follow-up should expose it (e.g. via an extended `TurnOutput` or an out-of-band callback).
- **Provider failure retry.** OpenRouter itself falls back across providers/GPUs on 5xx, but the provider does not retry on network errors. Retry policy is deferred to the backend.
- **Model selection.** The model is a constructor option; selection policy (routing, fallbacks across models) is a backend configuration concern, not a provider concern.

## Logging (observability)

Wired diagnostic logging into the agent loop and the LLM providers via the new
`@darkling/observability` package (consola-backed). Implementation concern: no
spec governs logging; additive output only, no behavioural change. The user
selected dev/diagnostic traces (out-of-band) and per-worker console as the
sink; the spec-authority question (whether to formalise observability via the
spec workflow) is deferred ("decide later").

- `AgentLoop` logs (tag `guide:loop`): interaction start (event count, budget,
  carryover, pressure, undispatched), per-turn LLM invocation (turn, tool count,
  previous results, remaining budget), provider failures, FINISHED, budget
  exhaustion before/after dispatch, per-turn dispatch summary (calls/ok/failed/
  undispatched), and interaction end (reason, turns, consumed, new carryover/
  pressure).
- `HttpLlmProvider` and `OpenRouterLlmProvider` log (tag `guide:provider`):
  request shape (endpoint/model/messages/tools), error responses (status), and
  response shape (finished/toolCalls count).

Logs are out-of-band and do not alter the constrained agent's "not directly
observable" reasoning model — they are not surfaced to the model or the User.
Full prompt/completion text is NOT logged (only request/response shape); this
avoids leaking content into logs and keeps output concise. See
`packages/observability/package.journal.md` for the cross-cutting decision and
gaps (bus-aggregated / remote sinks; a possible future observability spec).
