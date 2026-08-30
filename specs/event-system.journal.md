# Journal: Event system

This journal records the development of [event-system.spec.md](./event-system.spec.md). It is non-normative; the specification takes precedence.

> **Retired.** The event-system specification has been consolidated into [Constrained agent](./constrained-agent.spec.md); see the [Consolidation](./constrained-agent.journal.md#consolidation-event-system-merged-into-the-constrained-agent) section of the constrained-agent journal for the scope decisions, section mapping, and consistency review. This journal is retained as a historical record; the event-system spec itself is retained as a redirect. The content below reflects the state of the event-system spec prior to consolidation and is not maintained further.

## Origin

Created as the fourth specification, in response to a request to establish the event system spec referenced by both the three-way interaction and constrained agent specs. Established via the specification workflow.

## Scope decisions

Through dialogue with the user, the following scope decisions were made:

- **Event types: structure only.** The spec defines the event structure (type, timestamp, payload) and the queueing/flushing/triggering behaviour that applies uniformly to all event types. The specific event types and their payloads are left to the UI specification. This keeps the event system spec focused on the mechanism rather than the catalogue of events.
- **Budget policy: event system owns it.** The constrained agent spec defines the budget mechanism (cost-based, consumed by tool call costs, bounds the interaction); this spec owns the policy values (budget amount, tool call costs, overspend, carryover). This split was chosen because budget policy is closely tied to event-driven interaction frequency and the apparent-autonomy goals — the budget policy and flush policy are co-designed.
- **Flush policy: defined normatively.** The spec defines the hybrid immediate/probabilistic flush policy: immediate flush for certain event types, probabilistic flush at microbatching window expiry for others, with probabilities depending on event types. This is the core of the apparent-spontaneity requirement.

## Dependencies on not-yet-established specifications

This specification links to one spec that does not yet exist at the time of writing:

- The UI specification — owns the specific event types and their payloads.

When that specification is established, this journal should be updated to confirm the link resolves and that the referenced behaviour is consistent with the requirements stated here.

## Key decisions and rationale

### Unified probabilistic flush (no immediate/probabilistic distinction)

The initial draft distinguished immediate flush (certain event types) from probabilistic flush (at window expiry). The user simplified this: there is a single flush mechanism — a per-event roll against the event type's trigger probability. Event types that always flush simply have probability 1.0. This eliminates the separate immediate-flush category and the combination function for multiple event types in the queue, both of which were policy parameters in the initial draft.

### Per-event roll replaces time-based microbatching window

The initial draft used a time-based microbatching window. The user replaced this with a per-event roll: each time an event is added to the queue, a roll is made against that event's trigger probability. Microbatching emerges from failed rolls: low-probability events accumulate in the queue until a roll succeeds, at which point all accumulated events flush together. This is simpler (no timer, no window) and more reactive (the roll happens at the moment of event production, not at window expiry).

### Deferred rolls during interaction

The user specified that while an interaction is in progress, rolls for flush are deferred. Events are queued, and when the current interaction completes, the system iterates over the queued events in order, rolling for each. The first successful roll flushes the queue and triggers the next interaction; any remaining events stay in the queue. This resolves the "flush during interaction" and "concurrent interactions" gaps: there is no concurrent interaction — at most one interaction is in progress at any time, and flushes only occur between interactions. This also resolves the interaction precedence gap shared with the constrained agent spec: a high-probability event (e.g. direct address, probability 1.0) produced during an interaction does not interrupt it, but is guaranteed to trigger a flush once the interaction completes (since its roll always succeeds).

### Budget composition: base + premium + carryover

The initial draft had a single "budget amount" per interaction. The user specified a three-part composition:

- **base** — a fixed amount for every interaction;
- **premium** — an additional amount based on the event types in the queue, reflecting expected response cost (e.g. a direct address may carry a higher premium than a browsing event);
- **carryover** — the signed balance from previous interactions.

This gives the budget a richer structure that accounts for the nature of the triggering events, not just a flat allocation.

### Signed carryover (negative carryover for overspend)

The initial draft permitted only positive carryover (unspent budget carried forward). The user specified that carryover may be negative: if an interaction overspends, the debt is carried forward as negative carryover, reducing the next interaction's budget. This creates a self-correcting mechanism: overspend in one interaction constrains the next, preventing sustained over-budget behaviour. The spec defines both a maximum carryover (cap on positive) and a minimum carryover (cap on negative / maximum debt), plus decay toward zero for both.

### High-level semantic events, not low-level UI events

The README specifies that "the interface produces high-level semantic events such as document_opened, rather than exposing low-level UI events to the Guide." The spec makes this normative: events represent meaningful user actions or state changes, not raw input. This keeps the Guide's input semantically meaningful and reduces noise.

### Microbatching as emergent effect of per-event roll

The README states events are "microbatched and flushed using a hybrid immediate/probabilistic policy, reducing LLM calls and token usage." The spec now achieves microbatching as an emergent effect of the per-event roll: events with low trigger probabilities accumulate in the queue, and when a roll eventually succeeds, all accumulated events flush together. No events are discarded. This is simpler than the original time-window approach and achieves the same goal.

### Apparent spontaneity from per-event probabilistic flush

The probabilistic per-event roll produces the apparent spontaneity required by the three-way interaction spec. Because the roll is per-event with type-dependent probabilities, the timing of flushes varies with the User's activity pattern. Event types with probability 1.0 (e.g. direct address) always flush, while low-probability events may accumulate for several rolls before flushing.

### Budget policy co-located with flush policy

The decision to place budget policy in this spec (rather than the constrained agent spec or a separate policy spec) was driven by the tight coupling between budget and interaction frequency. The carryover mechanism — accumulate when quiet, spend when active — is co-designed with the flush policy: a Guide that is rarely triggered accumulates budget, while a Guide that is frequently triggered spends it. Placing both policies in the same spec keeps this co-design explicit.

### Tool costs visible in tool definitions

The user specified that tool call costs are included in the tool definitions sent to the model as part of the system prompt. This makes costs visible to the model at decision time, allowing it to weigh the cost of a tool call against the remaining budget when choosing whether and how to act. The spec now requires this normatively. The constrained agent spec's budget status section was updated to reference this, so the model sees both the remaining budget (in the status object) and the per-tool costs (in the tool definitions).

### Carryover with decay and signed balance

The spec defines carryover as a signed balance: positive for unspent budget, negative for overspend. Both are capped (maximum and minimum carryover) and both decay toward zero over time. This prevents both unbounded surplus accumulation and unbounded debt, while allowing the Guide to accumulate budget during quiet periods and constraining it after overspend.

### Bounded overspend

The spec requires a maximum permitted overspend because tool call costs may not be known precisely until dispatch (e.g. variable retrieval size, variable latency). Bounded overspend accommodates this uncertainty without permitting unbounded cost. The constrained agent spec defines the mechanism (no further dispatch after exhaustion); this spec defines the bound.

### Policy parameters table

The spec defines a table of policy parameters that must exist with defined values, but leaves the specific values to implementation. This makes the spec normative about the structure of the policy (which parameters exist, their required properties) while allowing implementation tuning. The table also serves as a checklist for conformance.

## Revision: probabilistic overspend and min(spent, remaining) carryover

The budget policy was substantially revised, via the specification workflow, to replace the maximum-permitted-overspend bound and the signed-carryover-with-caps-and-decay mechanism with two new mechanisms proposed by the user:

- **Carryover** is now $\text{carryover} = \min(\text{spent},\ \text{remaining})$, peaking at half-budget and zero both when declining to act and at full spend, with overspend producing a negative carryover (debt) directly through the `min`. This replaces the earlier "carry the remaining balance, capped and decayed" policy.
- **Pressure** is a new non-negative, decaying accumulator of overspend, updated per interaction as $p' = \max(0,\ \lfloor p/2 \rfloor - \min(0,\ r))$ — halving on frugal/at-budget interactions, growing by the overspend amount on overspent interactions, clamped to ≥ 0, unbounded above.
- **Overspend permission** is now a probabilistic gate, not a hard maximum. For a proposed overspend $o$, the probability of dispatch is $\sigma(1 - (\lfloor p/2 \rfloor + o)/\text{base})$, where $p$ is the current pressure and `base` is the budget base policy parameter. The numerator is the pressure that would result if the overspend were permitted (current pressure halved plus the overspend amount), scaled against the base. A failed roll makes the call undispatched and ends the interaction via the constrained-agent exhaustion path.

Through dialogue with the user, the following scope decisions were made:

- **`base_budget` in the sigmoid is the `base` parameter**, not the interaction's total budget, so the gate's scale is stable across interactions regardless of carryover or premium.
- **Pressure is unbounded above** (no hard cap). The sigmoid asymptotically suppresses overspend as pressure grows; the probability approaches 0 but is never exactly 0, so overspend is never deterministically forbidden. A hard floor was considered and rejected in favour of a purely soft gate.
- **A denied overspend becomes an undispatched tool call and ends the interaction**, consistent with the existing loop behaviour and the constrained-agent exhaustion path. The model cannot currently observe a budget denial to retry within the interaction; retry-by-model was rejected.
- **The "accumulate when quiet, spend when active" property is deliberately dropped.** Under `min(spent, remaining)`, declining to act yields zero carryover, so the Guide no longer builds a surplus by being quiet. Apparent autonomy now comes from the variable timing of the flush policy and the probabilistic overspend gate, not from budget hoarding. This is a visible behavioural change from the earlier policy and is intentional.

### Key decisions and rationale

#### Two orthogonal signals

The revision cleanly separates two concerns that the earlier signed-carryover policy conflated: carryover moves surplus/debt into the base budget (a budget-amount effect), while pressure is a separate, non-negative signal that governs only _whether_ future overspend is permitted (a permission effect). Overspend debt is now encoded once, in the negative carryover, rather than in both a signed carryover and a separate debt cap.

#### Soft, pressure-sensitive gate

The probabilistic gate is a deliberate departure from a deterministic overspend bound. Tool call costs may not be known precisely until dispatch, and a hard bound either permits a fixed overspend or forbids it. The sigmoid gate makes overspend progressively less likely as the Guide overspends more, which is a smoother, more naturalistic control than a cliff. Using the budget base as the denominator keeps the gate's steepness consistent; using the interaction total would make the gate tighter when in debt (a double-penalty with the negative carryover).

#### The `min` shape's incentive

The `min(spent, remaining)` shape rewards considered, partial spend (peaking at half-budget) rather than rewarding hoarding or full spend. This was the user's explicit intent: the Guide should be rewarded for spending roughly within its means, not for declining to act. The earlier "reward hoarding" policy is gone.

#### Pressure replaces the debt decay

The earlier policy had a separate carryover decay toward zero for both surplus and debt. The revision removes that: debt is repaid through the negative carryover reducing the next budget (which makes further overspend more likely, raising pressure), and pressure's halving-on-frugal-spend is the only decay. This is simpler — one decay mechanism (pressure halving) rather than a separate carryover decay with its own rate and threshold parameters.

### Spec consistency

The constrained-agent spec's budget mechanism language (exhaustion, undispatched calls, "policy-based overspend/carryover mechanisms") is unaffected; it defers the specific policy to this spec. The one stale rationale line in the constrained-agent spec ("accumulate budget when it is quiet and spend it when active") was softened to avoid contradicting the new policy while staying within its mechanism-only scope. The policy-parameter table was reduced (max permitted overspend, max/min carryover, carryover decay removed; budget base's description updated to note it is the gate's denominator). The conformance clause was updated to describe the new gate and carryover shape.

## Gaps and ambiguities

- **UI specification.** The spec references a UI specification for event types and payloads, which does not yet exist. The boundary between "event structure" (this spec) and "event types" (UI spec) should be confirmed when the UI spec is established.
- **Policy parameter values.** The spec requires all parameters to have defined values but does not prescribe them. Whether they are fixed, configurable, or dynamically adjusted is left to implementation.
- **Event queue capacity.** The spec does not define a maximum queue size or behaviour under extreme event accumulation. This may need clarification if the Guide is inactive for extended periods and low-probability events accumulate indefinitely.
- **Cost model details.** The spec states costs may be fixed or variable but does not prescribe the cost model. The specific cost assignment is a policy parameter, but the structure of variable costs (e.g. proportional to retrieval size) may need further specification.
- **Premium function.** The spec states the premium depends on event types in the queue but does not prescribe the premium function. This is a policy parameter, but the relationship between event types and premium values may need further specification.
- **Carryover shape vs decay.** The carryover is now $\min(\text{spent},\ \text{remaining})$ (no decay parameter); decay of overspend debt is handled by pressure's per-interaction halving, not by a carryover decay. Whether the half-budget peak and the loss of quiet-accumulation are the desired long-term dynamics should be revisited once the Guide's behaviour is observable.

## Session start event

Added `session_start` to the examples of probability-1.0 events in the
Trigger probability section, and a "Session start triggers the Guide's first
interaction" scenario to the Flush policy Gherkin. The event type and payload
are owned by the UI spec (ui.spec.md#session-start); this spec's change is
acknowledgement only — no structural change to the event model.

The framing decision (recorded in ui.journal.md) is that `session_start` is a
Visitor-initiated event (the Visitor arriving), not a system event, so no
amendment to the "events are produced in response to User activity" source
model was required. This closes the bootstrap→Guide-trigger gap: previously
the spec produced no event at session start to flush the queue for the first
interaction.
