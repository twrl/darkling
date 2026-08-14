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
- **carryover** — the carried-over balance from previous interactions, which may be positive (unspent budget) or negative (recent overspend).

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

A tool call may cause the cumulative cost to exceed the budget. The overspend policy determines the behaviour when this occurs.

- The overspend policy must define a maximum permitted overspend: the cumulative cost may exceed the budget by at most this amount.
- When the maximum permitted overspend is reached, no further tool calls must be dispatched, as defined by [Constrained agent](./constrained-agent.spec.md).
- The maximum permitted overspend is a policy parameter, as defined in [Policy parameters](#policy-parameters).

The overspend policy exists because tool call costs may not be known precisely until dispatch: a retrieval may return more content than anticipated, or a service may incur variable latency. The policy permits bounded overspend to accommodate this uncertainty while preventing unbounded cost.

### Carryover

The carryover is the balance of unspent or overspent budget from previous interactions, carried into the next interaction. Carryover may be positive or negative.

- **Positive carryover** — when an interaction ends with unspent budget, the remaining amount is carried forward as positive carryover, increasing the next interaction's budget.
- **Negative carryover** — when an interaction ends with overspend (cumulative cost exceeded the budget), the overspent amount is carried forward as negative carryover, reducing the next interaction's budget. This creates a debt that the Guide must work within until the carryover returns to positive or zero.

The carryover policy must define:

- a **maximum carryover** — the positive carryover is capped at this value;
- a **minimum carryover** (maximum debt) — the negative carryover is capped at this value;
- a **carryover decay** — carried-over balance that is not used within a defined period or number of interactions decays toward zero, reducing both positive and negative carryover over time.

The carryover decay ensures that neither surplus nor debt persists indefinitely: a quiet period erodes accumulated surplus, and time erodes accumulated debt.

Carryover contributes to the apparent autonomy required by [Three-way interaction](./three-way-interaction.spec.md): the Guide may accumulate budget when the User is quiet and spend it when active, producing responses that appear more considered and less uniformly constrained. Negative carryover ensures that overspend in one interaction constrains the next, preventing sustained over-budget behaviour.

```gherkin
Feature: Budget policy
  Rule: Budget is base + premium + carryover, with bounded overspend and signed carryover

  Scenario: Positive carryover from unspent budget
    Given the Guide completes an interaction with unspent budget R
    And R does not exceed the maximum carryover
    When the next interaction is triggered
    Then the carryover must be R
    And the next interaction's budget must be base + premium + R

  Scenario: Negative carryover from overspend
    Given the Guide completes an interaction with overspend D
    And D does not exceed the minimum carryover
    When the next interaction is triggered
    Then the carryover must be -D
    And the next interaction's budget must be base + premium - D

  Scenario: Carryover decays toward zero
    Given the Guide has positive carryover C
    And no interaction has been triggered for a period exceeding the decay threshold
    When the next interaction is triggered
    Then the carryover must be less than C
    And the next interaction's budget must be base + premium + decayed carryover

  Scenario: Overspend is bounded
    Given the Guide has remaining budget B
    And B is less than the cost of the next tool call
    And the overspend would not exceed the maximum permitted overspend
    When the Guide dispatches the tool call
    Then the tool call must be dispatched
    And the cumulative cost must exceed the budget by at most the maximum permitted overspend
```

## Policy parameters

The event system is governed by a set of policy parameters. This specification defines the parameters that must exist and their required properties; the specific values are implementation-defined and may be configurable.

The following policy parameters must be defined:

| Parameter                          | Description                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Trigger probability per event type | The probability of flushing when an event of that type is added to the queue, in the range [0.0, 1.0]. |
| Budget base                        | The fixed budget amount assigned to every interaction.                                                 |
| Budget premium function            | The function that determines the premium based on the event types in the flushed queue.                |
| Tool call costs                    | The cost assigned to each tool call type.                                                              |
| Maximum permitted overspend        | The maximum amount by which cumulative cost may exceed the budget.                                     |
| Maximum carryover                  | The cap on positive carryover (unspent budget carried forward).                                        |
| Minimum carryover                  | The cap on negative carryover (overspend debt carried forward).                                        |
| Carryover decay                    | The rate and threshold at which carried-over balance decays toward zero.                               |

All policy parameters must have defined values. An implementation must not leave any parameter undefined.

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
- the budget for each interaction is composed of base + premium + carryover, where premium depends on event types in the queue and carryover may be positive or negative;
- the budget policy defines tool call costs, a maximum permitted overspend, and a carryover policy with maximum carryover, minimum carryover, and decay;
- all policy parameters have defined values.
