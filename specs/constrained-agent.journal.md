# Journal: Constrained agent

This journal records the development of [constrained-agent.spec.md](./constrained-agent.spec.md). It is non-normative; the specification takes precedence.

## Origin

Created as the third specification, in response to a request to establish the constrained agent spec referenced by the three-way interaction spec. Established via the specification workflow.

## Scope decisions

Through dialogue with the user, the following scope decisions were made:

- **Tool set: categories + contracts.** The spec defines the three permitted tool categories (Navigate, Draw attention, Retrieve) with their contracts (parameters, effect, conflict, side effects), but does not define exact tool schemas (parameter types, return shapes). Those are left to the content-first retrieval spec (for Retrieve) and implementation (for Navigate and Draw attention).
- **Turn budget: bound + exhaustion behaviour.** The spec normatively defines the turn budget as bounding both reasoning steps and tool calls, with explicit exhaustion behaviour: the Guide must produce a coherent response when the budget is exhausted, and must not perform further reasoning or tool calls. This resolves the "turn-budget exhaustion behaviour" gap flagged in the three-way interaction journal.
- **Interleaved reasoning: defined.** The spec normatively defines that the Guide may interleave reasoning and tool calls in any order, and that reasoning steps count toward the turn budget. This formalises the README's "interleaved reasoning is supported."
- **Location.** `specs/constrained-agent.spec.md`, matching the path referenced by the three-way interaction spec.

## Dependencies on not-yet-established specifications

This specification links to three specs that do not yet exist at the time of writing:

- `specs/event-system.spec.md` — owns the trigger mechanism (direct address or event) that starts an interaction.
- `specs/content-first-retrieval.spec.md` — owns the Retrieve tool's query interface.
- `specs/annotations.spec.md` — owns the Guide's personality, private notes, and annotations.

When those specifications are established, this journal should be updated to confirm the links resolve and that the referenced behaviour is consistent with the requirements stated here.

### Update: event system spec established

The event system was established as [event-system.spec.md](./event-system.spec.md). It defined the event queue, microbatching, the per-event probabilistic flush policy, probabilistic interaction triggering, and budget policy (amount, tool call costs, overspend, carryover). This resolved several dependencies:

- The trigger mechanism is the flush policy: an interaction is triggered when the event queue is flushed.
- The budget policy (amount, costs, overspend, carryover) was owned by the event system spec, as anticipated by this spec's references. The constrained agent spec defined the mechanism; the event system spec defined the policy values.
- The apparent-spontaneity mechanism is the probabilistic flush, consistent with this spec's requirement that triggering is probabilistic.

> **Note:** The event-system spec has since been consolidated into this specification; see the [Consolidation](#consolidation-event-system-merged-into-the-constrained-agent) section below. The historical narrative in this and the preceding sections reflects the state prior to consolidation.

The interaction precedence gap (what happens if an interaction is in progress when a flush occurs) remains open and is recorded in both journals.

### Update: content-first retrieval spec established

The content-first retrieval spec has been established as [content-first-retrieval.spec.md](./content-first-retrieval.spec.md). It defines the four retrieval modes (by ID, by properties, by text, relationship traversal), result shapes, pagination, and the storage/indexing mechanisms (block store, property index, text index, relationship index, containment index). This resolves the knowledge base access tool category's retrieval interface dependency: the specific queries by which blocks are retrieved are now defined. The constrained agent spec's reference to content-first retrieval is confirmed as consistent.

### Update: annotations spec established

The annotations spec has been established as [annotations.spec.md](./annotations.spec.md). It defines annotations as authored document-level metadata: frontmatter on source files, attached to documents, compiled alongside them, immutable at runtime, and retrieved as metadata on document retrieval results (not via separate retrieval modes). This resolves the "grounding vs. annotations" tension flagged in the review: annotations come with document retrieval via knowledge base access tools, so the grounding rule applies uniformly — the Guide retrieves a document (including its annotations) through tool calls before expressing their content. The distinction between annotations and working memory is confirmed: annotations are authored and immutable at runtime; working memory is runtime-mutable via `update_working_memory`. The Guide's personality is authored through annotations, not emergent from runtime state.

### Update: service bus spec established

The service bus has been established as [service-bus.spec.md](./service-bus.spec.md). It defines the `ServiceBroker`/`ServiceHost` architecture (each in dedicated Web Workers), on-demand host activation, service registration, the SOAPjr-style message envelope (head for routing, body for payload), Transferable object handling, Zod 4 schema validation, and promise fulfilment. This is the execution substrate for this spec's tool call dispatch: each tool category is backed by services on the bus, and parallel dispatch of tool calls within a turn is supported by concurrent execution of service hosts in separate workers. The "tool call failure handling" review item (item 1) is partially addressed: the service bus defines error propagation (host returns error message, broker rejects promise, host failure rejects promise), which gives tool calls a failure path. The constrained agent's undispatched tool calls mechanism handles the case where a call fails to dispatch.

### Update: agent safety spec established

The agent safety spec has been established as [agent-safety.spec.md](./agent-safety.spec.md). It defines the `safety_consult` tool, which is in the agent self category alongside `update_working_memory`. The spec was updated to reference `safety_consult` in the agent self category description. The `safety_consult` tool calls a separate LLM agent (the safety consultant) that returns tiered advice: advisory notes (non-binding) and binding vetoes (the Guide must not produce vetoed content). The trigger is Guide-initiated, encouraged by prompt. The tool consumes budget like any other tool call. The Guide never breaks character — safety is handled internally and is invisible to the User.

### Update: interaction precedence resolved

The event system spec now specifies that while an interaction is in progress, rolls for flush are deferred. Events are queued, and when the current interaction completes, the system iterates over the queued events in order, rolling for each. This means at most one interaction is in progress at any time — there are no concurrent interactions, and a high-probability event (e.g. direct address) produced during an interaction does not interrupt it but is guaranteed to trigger a flush once the interaction completes. The interaction precedence gap recorded in this journal is resolved.

## Key decisions and rationale

### Agentic model clarified

The user clarified the agentic model, which substantially restructured the spec:

- **Events → queue → probabilistic trigger → interaction.** The UI produces events added to a queue; each event has a type-dependent probability of triggering an interaction. When triggered, the event queue and a status object are sent to the model. This resolves the "interaction input" gap: the input is the event queue + status object.
- **Tool-call-only output; free text not permitted.** The model responds entirely through tool calls. This required adding a **Respond** tool as the fourth permitted tool category, since the Guide needs a mechanism to send text to the User. FINISHED is a control signal, not a tool call.
- **FINISHED control signal.** The model returns FINISHED to end the interaction. FINISHED is not a tool call and produces no effect. It is also the mechanism by which the Guide declines to respond (returning FINISHED before issuing any tool calls).
- **Cost-based budget, not turn-counted.** The budget is consumed by tool call costs, not by counting turns. Different tool calls have different costs. Turns are the inference-cycle unit but are not counted toward the budget. This resolves the "duration" ambiguity: the budget is cost-based, not time-based.
- **Parallel tool dispatch.** Tool calls within a turn are dispatched in parallel where possible. This resolves the concurrency gap.
- **Overspend and carryover are policy-based.** This reverses the earlier "remaining budget must not carry over" decision. The user specified that there are policy-based mechanisms for budget overspend and for carrying unspent budget into future interactions. Carryover contributes to apparent autonomy (accumulate when quiet, spend when active). The specific policies are out of scope; the spec requires the mechanisms exist.
- **Undispatched tool calls.** Tool calls from the immediately previous interaction that could not be dispatched are included in the next interaction's status object. The model may reissue or discard them. They do not accumulate across multiple interactions.

### Turn vs. interaction terminology

Retained from the earlier decision: a **turn** is one inference cycle within an interaction; an **interaction** is the Guide's complete response to a single trigger. An interaction spans one or more turns. The model is invoked per turn, produces tool calls or FINISHED, and tool results feed the next turn. This is now in the Agentic model section rather than a standalone Terminology section.

### Tool category taxonomy replaces specific tool definitions

The user specified that tools fall into four broad categories: avatar and user interaction, UI control, knowledge base access, and agent self. The spec was restructured to define this taxonomy with the constraints that apply to each category, rather than defining specific tools (Navigate, Draw attention, Retrieve, Respond). Specific tools within each category are now deferred to their respective domain specifications — except for `update_working_memory`, which is defined here as it is central to the agent model.

This is a cleaner separation of concerns: this spec owns the agent's discipline and taxonomy; domain specs own the specific tools. The four categories are:

1. **Avatar and user interaction** — control the Guide's avatar, communicate with the User (replaces the former Respond tool)
2. **UI control** — navigate, draw attention (replaces the former Navigate and Draw attention tools); subject to User precedence
3. **Knowledge base access** — retrieve content, traverse relationships (replaces the former Retrieve tool); read-only
4. **Agent self** — affect the Guide's own state; includes `update_working_memory`

### Working memory

The user specified that the status object includes a `working_memory` field (an arbitrary JSON value) and an `update_working_memory` tool that replaces that value. This is the Guide's mutable state across interactions — resolving the "state between interactions" gap (review item 3). Key decisions:

- **Total replacement, not merge.** `update_working_memory` replaces the entire value; the model must compute the full replacement itself. This keeps the semantics simple and avoids partial-update complexity.
- **Persists across interactions, no fixed expiry.** Unlike the budget (per-interaction with carryover), working memory persists until replaced. This is the Guide's long-term state.
- **Not visible to the User, not part of the Archive.** Working memory is the Guide's private internal state, distinct from annotations (which attach to Archive content) and from the Archive's immutable record.
- **Relationship to the README's "rather than as mutable model memory."** Working memory is an explicit, bounded mechanism (one JSON value, replaced wholesale via a tool call), not unconstrained model memory. The Guide doesn't have free-form memory; it has a single, explicit, inspectable JSON value it can update through a tool. This satisfies the README's constraint while giving the Guide cross-interaction continuity.

### FINISHED is a provider-agnostic abstraction

The user noted that FINISHED corresponds to `finish_reason: "stop"` in the OpenAI Chat Completion API, and that this varies by underlying model provider. The spec now frames FINISHED as an abstraction over the provider's completion signal, with the OpenAI case given as an example. The implementation is required to map the provider's signal to FINISHED and treat it uniformly. This keeps the spec provider-agnostic while acknowledging the concrete representation.

### Constraints are enforced, not advisory

The spec makes the Guide's constraints normative and requires implementation enforcement, rather than treating them as guidelines. This follows the README's characterisation of the Guide as "an actor with constrained capabilities rather than as a conventional chatbot" and the three-way interaction spec's "constrained actor, not a chatbot." A constraint that isn't enforced isn't a constraint.

### Tool categories mirror the interaction spec's permitted actions

The three tool categories (Navigate, Draw attention, Retrieve) correspond exactly to the permitted Guide actions defined by the three-way interaction spec. This spec adds the tool-call contracts (parameters, effects, visibility, side effects) without redefining the actions or their conflict rules. The conflict rules are referenced, not restated, to avoid duplicating normative requirements across specs.

### Retrieve has no side effects

The spec explicitly states that Retrieve must not alter the Archive, interface, or persistent state. This distinguishes it from Navigate and Draw attention (which produce visible interface changes) and ensures the Guide cannot mutate the Archive through retrieval. This is consistent with the content model's passive Archive and the three-way interaction spec's Guide-as-actor-not-editor.

### No assertions about unretrieved content

The spec requires that the Guide must not assert facts about Archive content without having retrieved that content through a tool call (except for content provided as input). This is a key constraint that keeps the Guide grounded in retrieved content rather than hallucinating Archive material, consistent with the content-first retrieval model.

### Exhaustion produces a coherent response

The exhaustion behaviour requires a coherent response from accumulated content, explicitly forbidding incomplete mid-sentence/mid-thought responses and references to uncompleted tool calls. This ensures the User always receives a usable response even when the budget runs out, which matters for the experience of the Guide as responsive rather than broken.

### Budget value is an implementation concern

The spec requires that a budget exists and bounds both reasoning and tool calls, but does not prescribe the specific value or whether it is configurable. This keeps the spec focused on the structural requirement while allowing implementation tuning.

## Gaps and ambiguities

- **Specific tool definitions.** The spec defines the four tool categories and the `update_working_memory` tool. All other specific tools (avatar interaction, UI control, knowledge base access) are deferred to their respective domain specifications.
- **Multiple avatar interaction calls.** The spec does not define whether multiple avatar interaction calls within one interaction are permitted and how they are presented to the User. This may need clarification in the relevant domain spec.
- **Status object fields.** The spec requires the status object to include the budget, working memory, and undispatched tool calls, and permits additional fields. The full status object shape is not defined and may be further specified by other specs.
- **Working memory size and validation.** The spec defines working memory as an arbitrary JSON value with no size limit or schema. Implementation may need to impose limits; this is left to implementation for now.
- **Working memory reset policy.** The spec states working memory persists until replaced but does not define whether/when it is reset (e.g. on session start, on Guide reset). Left to implementation.

## Consolidation: event system merged into the constrained agent

Via the specification workflow, the [Event system](./event-system.spec.md) specification was consolidated into this specification. The event system spec is retired; it is retained as a redirect to this spec. The consolidation was driven by the observation that the event queue, flush policy, interaction triggering, and budget semantics are all part of the agentic model — they are the mechanism by which the Guide is driven and bounded — and the former split across two specs produced a circular dependency (the agentic model lived in the constrained agent spec but its core mechanics lived in the event system spec, and each constantly cross-referenced the other).

Through dialogue with the user, the following scope decisions were made:

- **Merge into one spec.** The constrained agent spec now owns the full agentic model: events, queue, flush, triggering, budget, tool discipline, working memory, FINISHED. The event-system spec is retired. The event-system journal is retained as a historical record with a pointer to this consolidation.
- **Event structure moves into the constrained agent spec.** The event structure (type/timestamp/payload, immutability, event sources) is part of the agentic model since events are its input. The UI spec continues to own only the vocabulary of event types and their payloads.
- **Policy parameters stay co-located.** The policy parameters table (trigger probabilities, budget base, premium function, tool call costs) remains in the spec that owns the behaviour it governs — now the consolidated constrained agent spec, rather than a separate event-system spec. The cross-cutting policy contract is still established by [Policy and configuration](./policy-and-configuration.spec.md).

### What moved

The following sections, formerly in event-system.spec.md, are now sections of this spec:

| Former event-system section | New section in this spec |
| --- | --- |
| Events (high-level semantic events, event structure, event sources) | [Events](./constrained-agent.spec.md#events) |
| Event queue (queue, queue lifecycle) | [Event queue](./constrained-agent.spec.md#event-queue) |
| Flush policy (per-event roll, trigger probability, microbatching, apparent spontaneity, Gherkin) | [Flush policy](./constrained-agent.spec.md#flush-policy) |
| Interaction triggering | [Interaction triggering](./constrained-agent.spec.md#interaction-triggering) |
| Budget policy (composition, tool call costs, overspend, pressure, carryover, Gherkin) | [Budget](./constrained-agent.spec.md#budget) (merged with the former budget mechanism sections) |
| Policy parameters | [Policy parameters](./constrained-agent.spec.md#policy-parameters) |

### What changed in the constrained agent spec

- The **Purpose and scope** section now states that the event queue, flush policy, interaction triggering, and budget semantics are part of the agentic model, and lists them among the governed concerns. The explicit out-of-scope item for the event system is removed; a new out-of-scope item for the UI event vocabulary is added.
- The **Agentic model** section formerly restated the event queue and probabilistic triggering, deferring to the event system spec for the mechanism. Those restatements are removed; the full mechanism now lives earlier in the spec (Events, Event queue, Flush policy, Interaction triggering), and the Agentic model section focuses on interaction input, model output, and turns.
- The **Budget** section formerly split mechanism (cost model, exhaustion, undispatched calls) from policy (composition, overspend, pressure, carryover), deferring the policy to the event system spec. The two are now unified: the Budget section owns both the mechanism and the policy. The "defined by policy as established by Event system" and "out of scope for this specification" disclaimers are removed; the specific costs are now policy parameters defined in [Policy parameters](#policy-parameters).
- The **Interaction triggering** section gains an explicit statement that at most one interaction is in progress at any time (formerly in the event-system queue lifecycle, and recorded in this journal as resolving the interaction precedence gap).
- The **Policy parameters** section gains a link to [Policy and configuration](./policy-and-configuration.spec.md) for the cross-cutting contract, replacing the former standalone preamble.
- Former cross-references to `./event-system.spec.md#...` throughout the spec are updated to internal references or removed as appropriate.

### Resolved gaps

Several gaps recorded in this journal are resolved by the consolidation:

- **Budget value, cost assignment, and configurability** — formerly "deferred to the event system spec or implementation." The budget policy now lives in this spec; the specific values are policy parameters defined in [Policy parameters](#policy-parameters), with the cross-cutting configurability contract established by [Policy and configuration](./policy-and-configuration.spec.md).
- **Overspend and carryover policies** — formerly "deferred to the event system spec or a dedicated policy spec." The full overspend gate, pressure, and carryover mechanisms now live in the [Budget](#budget) section of this spec.
- **Interaction trigger details** — formerly "owned by the event system spec; the boundary between trigger (event system) and interaction (this spec) should be confirmed." The trigger mechanism (flush policy) and the interaction model are now in the same spec; the boundary is dissolved.

### Spec consistency

All specifications that formerly linked to `event-system.spec.md` have been updated to link to the corresponding sections of `constrained-agent.spec.md`. The event-system spec is retained as a redirect with a section-mapping table for any external references. The policy-and-configuration spec's references to "Event system" as the owner of budget and flush policy parameters are updated to reference the constrained agent spec. No normative requirements have been changed by the consolidation; the content is reorganised, not altered, except for the removal of the now-redundant cross-references and deferral disclaimers.

## Cross-visit persistence mechanism moved here from Usage and deployment

After the usage-and-deployment spec was refocused on assembly and deployment, the per-tier session state persistence *mechanism* was moved into this specification's Persistence and scope section. The link reversed: previously this spec referenced usage-and-deployment for the implementation policy ("does not survive a reset ... beyond what implementation policy defines"); now usage-and-deployment states the deployment-level policy (per-tier configurable persistence) and references this spec for the mechanism.

This section now owns: the working memory value as the unit of persistence; persistent tiers restoring the prior value on return visits, ephemeral tiers discarding it; per-browser scope; clearing site data resets regardless of tier; and the budget carryover following the same per-tier policy with its carryover shape (`min(spent, remaining)`) owned here. New Gherkin scenarios for persistent/ephemeral restoration were added. The deployment-level policy (tier determined by token claims, persistence as a tier property) remains in usage-and-deployment.
