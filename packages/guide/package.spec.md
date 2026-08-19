# `@darkling/guide` package

## Purpose and scope

This specification defines the `@darkling/guide` package: the implementation package that provides the Guide's constrained-agent loop — the agentic logic by which the Guide operates as an LLM-based actor with bounded capabilities.

It governs:

- the package's public API surface — the types, classes, and functions exported from the package entry point and the service subpath;
- the package's structural contract — the modules, their responsibilities, and their relationships;
- the agent loop — turns, tool-call dispatch, budget enforcement, working memory, FINISHED, and undispatched tool calls;
- the tool registry and the four-category taxonomy enforcement;
- the agent-self tools (`update_working_memory`, `safety_consult`);
- the budget policy mechanics (composition, overspend, carryover);
- the LLM provider abstraction and the HTTP backend-proxy client;
- the service-bus integration — the Guide agent service declaration and implementation;
- the conformance of the package to [Constrained agent](../../specs/constrained-agent.spec.md), the budget policy of [Event system](../../specs/event-system.spec.md), the `safety_consult` tool of [Agent safety](../../specs/agent-safety.spec.md), and the LLM provider abstraction of [Usage and deployment](../../specs/usage-and-deployment.spec.md), which remain the normative specifications for their respective subsystems.

It is explicitly out of scope for this specification to define:

- the normative requirements of the constrained agent, event system, agent safety, or three-way interaction model — which are defined by their respective root specifications;
- the specific tools within the avatar-and-user-interaction, ui-control, and knowledge-base-access categories — which are defined by their respective domain specifications (not yet established). This package provides the registry and dispatch mechanism; the host registers concrete tools;
- the event system's flush policy and interaction triggering — which are owned by [Event system](../../specs/event-system.spec.md). This package consumes a flushed event queue and runs one interaction; it does not own the queue, the roll, or the trigger;
- the three-way interaction conflict resolution (User precedence) — which is owned by [Three-way interaction](../../specs/three-way-interaction.spec.md). UI-control tools are registered by the host and are responsible for yielding to User actions themselves;
- the specific LLM provider or the backend proxy's wire format beyond the default contract — which are implementation and configuration concerns.

Where this specification depends on behaviour defined by the root specifications, it links to them and states its requirement in terms of the package's conformance to that specification. This specification is an implementation contract: it governs how the package is structured and consumed, not the behavioural requirements of the subsystems themselves.

## Relationship to the root specifications

This package conforms to:

- [Constrained agent](../../specs/constrained-agent.spec.md) — defines the agentic model (events, turns, interaction input, model output), the Guide as a constrained actor, the tool-call discipline, the four tool categories, working memory, FINISHED, the cost-based budget, and undispatched tool calls. This package implements the agent loop that enforces these requirements.
- [Event system](../../specs/event-system.spec.md) — owns the budget policy: composition (base + premium + carryover, where carryover is `min(spent, remaining)`), tool call costs, a non-negative decaying pressure value, and a probabilistic overspend gate. This package implements the policy mechanics and the `BudgetTracker` / `InteractionBudget` bookkeeping; the policy values are parameters provided to the loop.
- [Agent safety](../../specs/agent-safety.spec.md) — defines the `safety_consult` tool and the tiered advice model. This package implements the tool declaration, the host-injected `SafetyConsultant` seam, and the tiered-advice return schema.
- [Usage and deployment](../../specs/usage-and-deployment.spec.md) — defines the LLM provider abstraction and the backend proxy. This package defines the provider-agnostic `LlmProvider` interface and an `HttpLlmProvider` client that calls the backend proxy.

The package does not restate the normative requirements of those specifications. Where the package makes an implementation decision that a root specification leaves open, that decision is recorded in [package.journal.md](./package.journal.md).

## Design context

The Guide operates as an agent driven by events from the UI, as defined by [Agentic model](../../specs/constrained-agent.spec.md#agentic-model). This package implements the loop that runs in the Guide's dedicated Web Worker, as defined by [Runtime topology](../../specs/usage-and-deployment.spec.md#runtime-topology). The loop is worker-safe: it uses no Node.js or DOM APIs and depends only on the injected `LlmProvider`, `ToolRegistry`, and `BudgetTracker`.

The package is the execution substrate for the constrained-agent discipline. It does not own the event queue or the trigger (the event system does); it consumes a flushed event queue when triggered and runs one interaction, returning the outcome. The host (the frontend) is responsible for queueing events, rolling for flush, and calling `runInteraction` when a flush occurs.

## Public API surface

The package is consumed via the main subpath (`@darkling/guide`) and the service subpath (`@darkling/guide/service`). Internal modules are not exported.

### Main subpath (`@darkling/guide`)

#### Core model types

The package exports the interaction model types defined by [Constrained agent](../../specs/constrained-agent.spec.md):

- `GuideEvent` — a high-level semantic event (type, timestamp, payload), as defined by [Event system](../../specs/event-system.spec.md#events). The payload is opaque to the loop.
- `ToolCall`, `ToolResult` — a tool call issued by the model and the result of dispatching it.
- `InteractionInput` — the event queue and status object sent to the model, as defined by [Interaction input](../../specs/constrained-agent.spec.md#interaction-input).
- `InteractionStatus` — the status object: budget, working memory, undispatched tool calls.
- `BudgetStatus` — the budget for an interaction (total, consumed, remaining), as defined by [Budget status](../../specs/constrained-agent.spec.md#budget-status).
- `UndispatchedToolCall` — a tool call that could not be dispatched, surfaced in the next interaction's status, as defined by [Undispatched tool calls](../../specs/constrained-agent.spec.md#undispatched-tool-calls).
- `InteractionOutcome` — the outcome of a completed interaction (reason, consumed, undispatched, working memory).
- `TurnOutput` — the model's output in a turn (tool calls or FINISHED).
- `FINISHED` — the control signal constant, as defined by [FINISHED](../../specs/constrained-agent.spec.md#finished).

#### Tool registry and categories

- `ToolCategory` — the union of the four permitted categories, as defined by [Tool categories](../../specs/constrained-agent.spec.md#tool-categories).
- `ToolDeclaration` — a tool's name, category, Zod parameter/return schemas, cost, and description. The cost and description are included in the tool's definition sent to the model, as required by [Tool call costs](../../specs/event-system.spec.md#tool-call-costs).
- `ToolHandler` — a function executing a tool call.
- `ToolDispatchContext` — the context provided to a handler: remaining budget, host capabilities, and working-memory access.
- `ToolRegistry` — the injectable registry. Enforces the four-category taxonomy at registration; rejects unknown tools, prohibited categories, and invalid parameters at dispatch, as required by [Prohibited tools](../../specs/constrained-agent.spec.md#prohibited-tools). Validates parameters and return values against Zod schemas.
- `ToolRejectedError` — thrown when a tool call is rejected.

#### Agent-self tools

- `update_working_memory` — the declaration, handler factory, and tool name, as defined by [Working memory](../../specs/constrained-agent.spec.md#working-memory). The handler replaces the loop's working-memory holder via the dispatch context; the replacement is total, not partial, and takes effect for the next interaction.
- `safety_consult` — the declaration, handler factory, return schema, and tool name, as defined by [Agent safety](../../specs/agent-safety.spec.md). The handler delegates to a host-injected `SafetyConsultant`; the consultant returns tiered advice (`info`, `warning`, `critical`).
- `SafetyConsultant` — the host-injected consultant interface. The package remains provider-agnostic; the host supplies the consultant (e.g. a service-bus proxy to the backend's consultant service).

#### Budget policy

- `BudgetPolicy` — the policy parameters defined by [Budget policy](../../specs/event-system.spec.md#budget-policy): base, premium function, tool costs, and an optional injectable `RandomSource` for the probabilistic overspend gate.
- `DEFAULT_BUDGET_POLICY` — a conservative default; the host overrides via configuration, per [Policy and configuration](../../specs/policy-and-configuration.spec.md).
- `BudgetTracker` — tracks carryover (`min(spent, remaining)`) and pressure (`max(0, floor(p/2) - min(0, remaining))`) across interactions, as defined by [Carryover](../../specs/event-system.spec.md#carryover) and [Pressure](../../specs/event-system.spec.md#pressure).
- `InteractionBudget` — the budget state for an in-progress interaction, enforcing the cost-based bound and the probabilistic overspend gate (via `attemptDispatch`, which rolls the gate for overspend attempts), as defined by [Budget](../../specs/constrained-agent.spec.md#budget) and [Overspend](../../specs/event-system.spec.md#overspend). A denied overspend marks the budget exhausted and ends the interaction.
- `sigmoid`, `overspendProbability` — the logistic sigmoid and the gate probability function `sigmoid(1 - (floor(pressure/2) + proposed_overspend) / base)`, as defined by [Overspend](../../specs/event-system.spec.md#overspend).
- `RandomSource`, `DispatchAttempt` — the randomness source interface and the `'ok' | 'denied'` dispatch-attempt result.

#### LLM provider

- `LlmProvider` — the provider-agnostic interface: `turn(request)` returns tool calls or FINISHED, as defined by [Turns](../../specs/constrained-agent.spec.md#turns). The same interface is used on both sides of the LLM proxy: the frontend's `HttpLlmProvider` calls the backend, and the backend's upstream provider (e.g. `OpenRouterLlmProvider`) implements the same interface against the upstream model API. This symmetry keeps the abstraction uniform, as defined by [LLM provider abstraction](../../specs/usage-and-deployment.spec.md#llm-provider-abstraction).
- `HttpLlmProvider` — a client that calls the backend's LLM proxy over HTTP, as defined by [LLM proxy](../../specs/usage-and-deployment.spec.md#llm-proxy). The API key is held by the backend; the token is attached by the Service Worker.
- `OpenRouterLlmProvider` — an upstream `LlmProvider` that calls the OpenRouter chat completions API. Intended for backend use only; the API key is held server-side and must not be sent to the frontend. Maps the constrained-agent turn model onto OpenRouter's OpenAI-compatible API: the interaction input is rendered into system and user messages; tools are emitted as OpenAI function tools with their Zod parameter schemas converted to JSON Schema via `z.toJSONSchema`; previous tool results are sent as `tool` messages; `tool_calls` responses are mapped to `ToolCall`s, and any non-`tool_calls` finish reason (`stop`, `length`, `content_filter`, `error`) is mapped to FINISHED, as defined by [FINISHED](../../specs/constrained-agent.spec.md#finished). Non-streaming only.
- `ScriptedLlmProvider` — a scripted provider for tests and bootstrap.
- `LlmTurnRequest`, `TurnResultEntry` — the request sent to the provider and the tool-result entries forwarded for subsequent turns.
- `OpenRouterLlmProviderOptions` — options for the OpenRouter provider: API key, model, endpoint, fetch, site attribution headers, temperature, max tokens.

#### Agent loop

- `AgentLoop` — the constrained-agent loop. Owns the working-memory holder and a `BudgetTracker`; runs one interaction at a time when triggered. Enforces tool-call discipline, parallel dispatch, budget exhaustion, FINISHED, and undispatched tool calls.
- `AgentLoopOptions` — loop options (max turns safety bound).

### Service subpath (`@darkling/guide/service`)

- `guideServiceDeclaration` — the `ServiceDeclaration` for the `guide` service, exposing `runInteraction` as a service function with Zod-validated parameters and returns, as defined by [Service registration](../../specs/service-bus.spec.md#service-registration).
- `GuideService` — the `ServiceImplementation` that owns an `AgentLoop` and dispatches `runInteraction` calls to it. Instantiated by the host with a `HostContext` carrying `GuideServiceOptions` (provider, registry, budget policy, initial working memory).
- `GuideServiceOptions`, `GuideServiceDeclaration` — the service options and the declaration-shaped type for the `ServiceImplementation` generic.

## Conformance

An implementation of this package conforms when:

- the agent loop enforces the tool-call discipline: the model responds through tool calls or FINISHED; tool calls outside the four categories are rejected; free text is not produced, as defined by [Constrained agent](../../specs/constrained-agent.spec.md);
- the loop dispatches tool calls in parallel within a turn, enforces the cost-based budget, ends the interaction on FINISHED or budget exhaustion, and carries undispatched tool calls to the next interaction;
- working memory is replaced wholesale via `update_working_memory` and persists across interactions, surfacing in the next interaction's status;
- the budget is composed of base + premium + carryover, with bounded overspend and signed, capped, decaying carryover, as defined by [Event system](../../specs/event-system.spec.md#budget-policy);
- the `safety_consult` tool is in the agent-self category, invokes a separate LLM agent via the host-injected `SafetyConsultant`, and returns tiered advice conforming to the advice structure, as defined by [Agent safety](../../specs/agent-safety.spec.md);
- the `LlmProvider` interface accommodates the constrained-agent interaction model and maps the provider's completion signal to FINISHED;
- the service-bus integration exposes the agent loop as a `guide` service with a Zod-validated `runInteraction` function, as defined by [Service bus](../../specs/service-bus.spec.md);
- the OpenRouter upstream provider maps the constrained-agent turn model onto OpenRouter's OpenAI-compatible chat completions API, maps `tool_calls` to `ToolCall`s, and maps any non-`tool_calls` finish reason to FINISHED, holding the API key server-side, as defined by [LLM provider abstraction](../../specs/usage-and-deployment.spec.md#llm-provider-abstraction) and [FINISHED](../../specs/constrained-agent.spec.md#finished).
