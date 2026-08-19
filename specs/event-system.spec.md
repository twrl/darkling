# Event system

## Purpose and scope

This specification defines the event system: the mechanism by which the UI produces high-level semantic events, the event queue that accumulates them, the per-event probabilistic flush policy that determines when events are presented to the Guide, the triggering of interactions, and the budget policy that governs interaction cost.

It governs:

- the structure and semantics of events;
- the event queue and its lifecycle;
- the per-event probabilistic flush policy and its microbatching effect;
- interaction triggering;
- budget policy: budget composition (base, premium, carryover), tool call cost assignment, overspend, and carryover.

It is explicitly out of scope for this specification to define:

- the specific set of high-level semantic event types (e.g. `document_opened`, `attention_drawn`) and their payloads — which are defined by the UI specification;
- the constrained agent's tool-call discipline, tool categories, FINISHED, working memory, and the agentic model of turns and interactions — which are defined by [Constrained agent](./constrained-agent.spec.md);
- the three-way interaction model — roles, interaction channels, and interface conflict resolution — which are defined by [Three-way interaction](./three-way-interaction.spec.md);
- the content model — documents, content blocks, and relationships — which are defined by [Content model](./content-model.spec.md).

Where this specification depends on behaviour defined by those specifications, it links to them and states its requirement in terms of their observable behaviour.

## Events

### High-level semantic events

The UI produces high-level semantic events rather than exposing low-level UI events to the Guide. A high-level semantic event represents a meaningful user action or interface state change — for example, a document being opened, or attention being drawn to a block — rather than a raw input event such as a click or keystroke.

The specific event types and their payloads are defined by the UI specification. This specification governs the structure, queueing, flushing, and triggering behaviour that applies to all event types uniformly.

### Event structure

Every event must carry:

- **type** — the event type, from the controlled vocabulary established by the UI specification;
- **timestamp** — the time at which the event occurred;
- **payload** — event-type-specific data describing the event.

An event is immutable once produced: its type, timestamp, and payload must not change after creation.

### Event sources

Events are produced by the UI in response to User activity. The Guide does not produce events; the Guide consumes them. Guide-initiated actions (tool calls) produce their effects through the [Constrained agent](./constrained-agent.spec.md) and [Three-way interaction](./three-way-interaction.spec.md) models, not through the event system.

## Event queue

Events accumulate in an event queue. The event queue is the buffer between event production and interaction triggering.

- Events must be added to the queue in the order they are produced.
- The queue must preserve event ordering: events must be presented to the Guide in the order they were produced.
- When an interaction is triggered, the current contents of the queue are sent to the model as the event queue component of the interaction input, as defined by [Constrained agent](./constrained-agent.spec.md).
- Events that have been sent to the model as part of an interaction are consumed: they must not be sent again in a subsequent interaction.

### Queue lifecycle

The queue accumulates events between interactions. When an interaction is triggered, the queue is flushed: its contents are sent to the model and the queue is cleared of consumed events.

While an interaction is in progress, events produced by the UI are added to the queue but rolls for flush are deferred: no flush occurs during an interaction. When the current interaction completes, the system iterates over the queued events in order, rolling for flush on each. The first successful roll flushes the queue and triggers the next interaction; any remaining events after the flush stay in the queue and are iterated over after that interaction completes.

- Events produced during an interaction are not lost: they are added to the queue and retained.
- Rolls are deferred, not skipped: every queued event is rolled for after the current interaction completes.
- If no roll succeeds during the post-interaction iteration, the events remain in the queue and are included in future iterations as further events are added.

## Flush policy

The queue is flushed by a single probabilistic mechanism: each time an event is added to the queue, a roll is made against that event's trigger probability to determine whether to flush. There is no time-based window and no separate immediate-flush category; event types that always trigger a flush simply have a trigger probability of 1.0.

### Per-event roll

When an event is added to the queue, the system rolls against the trigger probability assigned to that event's type:

- if the roll succeeds, the queue is flushed: all accumulated events are sent to the model and the queue is cleared of consumed events, triggering an interaction as defined in [Interaction triggering](#interaction-triggering);
- if the roll fails, the event remains in the queue with all previously accumulated events, and no flush occurs.

The roll is performed once per event added, not per event already in the queue. The trigger probability is a property of the event type being added, not of the queue's contents.

If an event is added while an interaction is in progress, the roll is deferred until the interaction completes, as defined in [Queue lifecycle](#queue-lifecycle).

### Trigger probability

Each event type has a trigger probability in the range [0.0, 1.0]:

- an event type with probability 1.0 always triggers a flush when added — for example, a direct address from the User;
- an event type with probability 0.0 never triggers a flush when added — the event accumulates in the queue and may be flushed by a later event's roll;
- an event type with probability between 0.0 and 1.0 triggers a flush with that probability — for example, a routine browsing event with a low probability.

The trigger probability per event type is a policy parameter, as defined in [Policy parameters](#policy-parameters).

### Microbatching effect

The per-event roll produces microbatching as an emergent effect: events with low trigger probabilities accumulate in the queue, and when a roll eventually succeeds, all accumulated events are flushed together as a single batch. This reduces LLM calls and token usage by grouping rapid sequences of events (e.g. a User scrolling through several documents) into a single interaction input, rather than triggering an interaction for each event.

Microbatching does not discard events: all events in the queue are retained and presented together when the queue is flushed.

### Apparent spontaneity

The probabilistic flush produces the apparent spontaneity required by [Three-way interaction](./three-way-interaction.spec.md): the Guide's responses are not uniformly triggered by each event, but exhibit variable timing. Because the roll is per-event with type-dependent probabilities, the timing of flushes — and therefore of Guide responses — varies with the User's activity pattern and the event types it produces.

```gherkin
Feature: Flush policy
  Rule: The queue is flushed by a per-event probabilistic roll

  Scenario: High-probability event triggers flush
    Given the event queue contains a document_opened event
    When a direct_address event with trigger probability 1.0 is added
    Then the queue must be flushed
    And all accumulated events must be included in the flush

  Scenario: Low-probability event does not flush
    Given the event queue is empty
    When a document_opened event with trigger probability 0.1 is added
    And the roll fails
    Then the event must remain in the queue
    And no flush must occur

  Scenario: Accumulated events flush together
    Given the event queue contains two document_opened events from failed rolls
    When a third document_opened event is added
    And the roll succeeds
    Then the queue must be flushed
    And all three events must be included in the flush

  Scenario: Rolls deferred during interaction
    Given an interaction is in progress
    When a direct_address event with trigger probability 1.0 is added to the queue
    Then no flush must occur immediately
    When the current interaction completes
    Then the system must iterate over the queued events in order
    And the direct_address event must trigger a flush
    And the queue must be flushed, triggering the next interaction

  Scenario: No successful roll after interaction
    Given an interaction completes
    And the queue contains events with low trigger probabilities
    When the system iterates over the queued events
    And no roll succeeds
    Then the events must remain in the queue
    And no interaction must be triggered
```

## Interaction triggering

A flush of the event queue triggers an interaction, as defined by [Constrained agent](./constrained-agent.spec.md). The interaction receives the flushed event queue as part of its input.

- Each flush triggers at most one interaction.
- The probability of a flush, and therefore of triggering an interaction, is determined by the trigger probability of the event type being added.
- An interaction trigger does not guarantee that the Guide will respond: the Guide may return FINISHED without issuing any tool calls, as defined by [Constrained agent](./constrained-agent.spec.md).

## Budget policy

The budget policy governs the cost-based budget that bounds each Guide interaction, as defined by [Constrained agent](./constrained-agent.spec.md). This specification owns the policy: the budget composition, the cost assigned to each tool call type, and the overspend and carryover mechanisms.

### Budget composition

Each interaction's budget is composed of three parts:

- **base** — a fixed budget amount assigned to every interaction;
- **premium** — an additional amount determined by the event types in the flushed event queue, reflecting the expected cost of responding to those events;
- **carryover** — the carried-forward balance from the immediately previous interaction, which may be positive (partial spend) or negative (overspend).

The interaction's budget is:

$$\text{budget} = \text{base} + \text{premium} + \text{carryover}$$

- The base is a policy parameter, as defined in [Policy parameters](#policy-parameters).
- The premium is a function of the event types in the queue: event types that are expected to require more Guide effort (e.g. a direct address) may carry a higher premium than routine events. The premium function is a policy parameter.
- The carryover is defined in [Carryover](#carryover).

### Tool call costs

Each tool call type has an assigned cost. The cost represents the resource expenditure of dispatching the tool call — for example, the computational cost of a retrieval, or the latency cost of a UI control operation.

- The cost assigned to each tool call type is a policy parameter, as defined in [Policy parameters](#policy-parameters).
- Different tool categories may have different cost profiles: knowledge base access tools may have costs proportional to the amount of content retrieved, while avatar interaction tools may have fixed costs.
- The specific cost model — whether costs are fixed per tool type, variable based on parameters, or a combination — is a policy parameter.
- The cost of each tool must be included in the tool's definition sent to the model as part of the system prompt. This makes costs visible to the model at decision time, allowing it to weigh the cost of a tool call against the remaining budget when choosing whether and how to act.

### Overspend

A tool call may cause the cumulative cost to exceed the budget — for example, when a tool call's cost is not known precisely until dispatch. The overspend policy determines whether such a call is dispatched.

The Guide accumulates a non-negative **pressure** value across interactions that records recent overspend. Pressure is a decaying accumulator: it grows when an interaction overspends and decays when an interaction is frugal, so sustained frugal behaviour relieves pressure while sustained overspend raises it. Pressure is defined in [Pressure](#pressure).

Whether a tool call that would exceed the budget is dispatched is determined by a **probabilistic overspend gate** applied at the moment of dispatch. The gate computes the pressure that _would_ result if the overspend were permitted — i.e. the current pressure halved (its decay step) plus the proposed overspend — and scales that against the budget base. For a proposed overspend $o$ (the amount by which the call would exceed the remaining budget) given current pressure $p$ and the budget base $b$, the probability that the call is permitted is:

$$\text{probability\_allowed} = \sigma\!\left(1 - \frac{\lfloor p/2 \rfloor + o}{b}\right)$$

where $\sigma$ is the logistic sigmoid. The numerator $\lfloor p/2 \rfloor + o$ is exactly the pressure that would be recorded at the end of the interaction if this overspend were permitted (the pressure decay step applied to the current pressure, plus the overspend amount), so the gate compares the prospective resulting pressure to the budget base.

- The gate is applied per attempted overspend. A roll against $\text{probability\_allowed}$ determines whether the call is dispatched.
- If the roll succeeds, the call is dispatched and its cost consumed, increasing the interaction's overspend.
- If the roll fails, the call is not dispatched and becomes an undispatched tool call, as defined by [Constrained agent](./constrained-agent.spec.md#undispatched-tool-calls); the interaction ends via the exhaustion path, as defined by [Exhaustion](./constrained-agent.spec.md#exhaustion).
- The gate is a soft bound: overspend is never deterministically permitted (the probability is always less than 1) and, because pressure is unbounded above, sustained overspend drives the probability toward 0 but never forbids overspend absolutely. There is no fixed maximum permitted overspend amount.
- The base $b$ used in the gate is the budget base policy parameter, not the interaction's total budget, so the gate's scale is stable across interactions regardless of carryover or premium.

The gate exists because tool call costs may not be known precisely until dispatch: a retrieval may return more content than anticipated, or a service may incur variable latency. The probabilistic gate accommodates this uncertainty while making sustained overspend progressively less likely, in proportion to how much the Guide has recently overspent.

### Pressure

Pressure is a non-negative value carried across interactions that records recent overspend. It is the input to the probabilistic overspend gate, as defined in [Overspend](#overspend).

At the end of each interaction, with $r$ the interaction's remaining budget ($\text{total} - \text{spent}$, which is negative on overspend), pressure is updated as:

$$p' = \max\!\left(0,\ \left\lfloor \frac{p}{2} \right\rfloor - \min(0,\ r)\right)$$

- If the interaction was frugal or on budget ($r \geq 0$), then $\min(0, r) = 0$ and pressure is halved toward zero (decay).
- If the interaction overspent ($r < 0$, with overspend $|r|$), then $\min(0, r) = r$ and pressure becomes $\lfloor p/2 \rfloor + |r|$ (halving the prior pressure, then adding the overspend amount).
- Pressure is clamped to be non-negative; it may never go negative (there is no "credit" state).

Pressure replaces the maximum-permitted-overspend bound and the signed-carryover debt mechanism of earlier drafts. It is unbounded above; the sigmoid gate asymptotically suppresses overspend as pressure grows, so a hard cap is not required.

### Carryover

The carryover is the balance carried forward from the immediately previous interaction into the next interaction's budget. Carryover may be positive or negative.

At the end of an interaction, with $s$ the cost spent during the interaction and $r$ the remaining budget ($\text{total} - s$), the carryover is:

$$\text{carryover} = \min(s,\ r)$$

- The carryover peaks at half the interaction's budget (when $s = r = \text{total}/2$) and is zero both when the Guide declines to act ($s = 0$) and when it spends exactly its budget ($s = \text{total}$).
- When the interaction overspends ($s > \text{total}$, so $r < 0$), the carryover is negative: $\min(s, r) = r$, carrying the debt forward and reducing the next interaction's budget. Overspend debt is therefore encoded once, in the carryover; pressure (a separate, non-negative signal) governs only whether future overspend is permitted, not the budget amount.
- There is no separate cap on carryover (positive or negative) and no time-based decay: the $\min$ shape itself bounds carryover to $[-\text{total}, \text{total}/2]$, and overspend debt is naturally repaid because a negative carryover reduces the next budget, which in turn raises the chance of further overspend raising pressure rather than persisting debt indefinitely.

The carryover shape is a deliberate departure from a strictly per-interaction budget and from a "reward hoarding" policy: it rewards considered, partial spend rather than declining to act, and it encodes overspend debt directly into the next budget. Apparent autonomy is provided by the variable timing of the flush policy and the probabilistic overspend gate, not by accumulating surplus during quiet periods.

```gherkin
Feature: Budget policy
  Rule: Budget is base + premium + carryover; overspend is gated by a pressure-driven probability

  Scenario: Carryover peaks at half-budget spend
    Given an interaction with total budget T spends exactly T/2
    When the next interaction is triggered
    Then the carryover must be T/2
    And the next interaction's budget must be base + premium + T/2

  Scenario: Declining to act carries nothing forward
    Given an interaction spends nothing (s = 0)
    When the next interaction is triggered
    Then the carryover must be 0
    And the next interaction's budget must be base + premium

  Scenario: Overspend carries debt forward
    Given an interaction with total budget T overspends by D (s = T + D)
    When the next interaction is triggered
    Then the carryover must be -D
    And the next interaction's budget must be base + premium - D

  Scenario: Pressure grows on overspend and decays on frugal spend
    Given the current pressure is P
    And an interaction overspends by D
    When the interaction ends
    Then the pressure must be (P / 2) + D
    Given the current pressure is P
    And an interaction spends within budget
    When the interaction ends
    Then the pressure must be P / 2

  Scenario: Pressure is non-negative
    Given the current pressure is 0
    And an interaction spends within budget
    When the interaction ends
    Then the pressure must be 0

  Scenario: Overspend is gated by a pressure-driven probability
    Given the Guide attempts a tool call that would overspend by O
    And the current pressure is P
    When the gate is evaluated
    Then the probability of the call being permitted must be sigmoid(1 - ((P / 2) + O) / base)
    And the call must be dispatched iff the roll succeeds
    And a failed roll must make the call undispatched and end the interaction

  Scenario: Sustained overspend suppresses further overspend
    Given the Guide has overspent repeatedly such that pressure is high
    When the Guide attempts a further overspend
    Then the probability of the call being permitted must be lower than for a Guide with low pressure
    But the probability must not be exactly 0
```

## Policy parameters

The event system is governed by a set of policy parameters. This specification defines the parameters that must exist and their required properties; the specific values are implementation-defined and may be configurable.

The following policy parameters must be defined:

| Parameter                          | Description                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Trigger probability per event type | The probability of flushing when an event of that type is added to the queue, in the range [0.0, 1.0].           |
| Budget base                        | The fixed budget amount assigned to every interaction; also the denominator of the probabilistic overspend gate. |
| Budget premium function            | The function that determines the premium based on the event types in the flushed queue.                          |
| Tool call costs                    | The cost assigned to each tool call type.                                                                        |

All policy parameters must have defined values. An implementation must not leave any parameter undefined.

The probabilistic overspend gate is fully determined by the budget base and the current pressure; it introduces no additional policy parameter. The gate's randomness is provided by the same roll mechanism used for the flush policy; an implementation must provide a deterministic, injectable randomness source so that the gate is testable.

## Conformance

An implementation conforms to this specification when:

- the UI produces high-level semantic events with type, timestamp, and payload, and events are immutable once produced;
- events accumulate in an ordered event queue and are consumed when sent to the model;
- when an event is added to the queue, a roll is made against that event type's trigger probability, and the queue is flushed if the roll succeeds;
- while an interaction is in progress, rolls are deferred until the interaction completes, then the system iterates over queued events in order, rolling for each;
- event types with trigger probability 1.0 always flush; event types with probability 0.0 never flush; intermediate probabilities flush with the corresponding probability;
- failed rolls leave events in the queue, producing microbatching as accumulated events flush together on a successful roll;
- probabilistic flush produces variable response timing (apparent spontaneity);
- each flush triggers at most one interaction, as defined by [Constrained agent](./constrained-agent.spec.md);
- the budget for each interaction is composed of base + premium + carryover, where premium depends on event types in the queue and carryover is $\min(\text{spent},\ \text{remaining})$ from the previous interaction (positive for partial spend, negative for overspend);
- the budget policy defines tool call costs, a pressure value that accumulates overspend and decays on frugal spend (non-negative, unbounded), and a probabilistic overspend gate whose probability is $\sigma(1 - ((\text{pressure}/4) + \text{proposed\_overspend})/\text{base})$, with a failed gate making the call undispatched and ending the interaction;
- all policy parameters have defined values.
