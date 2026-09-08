# Constrained agent

## Purpose and scope

This specification defines the Guide as a constrained agent: the complete agentic model by which the Guide operates as an LLM-based actor with bounded capabilities. This includes the event queue that accumulates UI-produced events, the per-event probabilistic flush policy that determines when events are presented to the Guide, the triggering of interactions, the budget policy that governs interaction cost, the Guide's exclusive use of tool calls (with no free text), the tool category taxonomy, the FINISHED control signal, and the working memory mechanism for cross-interaction state.

The event queue, flush policy, interaction triggering, and budget semantics are part of the agentic model. They are not UI concerns and are not runtime infrastructure; they are the mechanism by which the Guide is driven and bounded.

It governs:

- events: the structure and semantics of the high-level semantic events the UI produces, the event queue and its lifecycle, the per-event probabilistic flush policy and its microbatching effect, and interaction triggering;
- the budget policy: budget composition (base, premium, carryover), tool call cost assignment, the probabilistic overspend gate, pressure, and carryover;
- the Guide's status as a constrained actor rather than a conventional chatbot;
- the tool-call discipline: the Guide responds entirely through tool calls; free text is not permitted;
- the four tool categories and their taxonomy;
- the `update_working_memory` tool and the `working_memory` status field;
- the FINISHED control signal;
- the cost-based budget mechanism, including exhaustion and undispatched tool calls;
- the agentic model of turns and interactions: interaction input, model output, and turn structure.

It is explicitly out of scope for this specification to define:

- the specific set of high-level semantic event types (e.g. `document_opened`, `attention_drawn`) and their payloads — which are defined by [User interface](./ui.spec.md);
- the three-way interaction model — roles, interaction channels, and interface conflict resolution — which is defined by [Three-way interaction](./three-way-interaction.spec.md);
- the content model — documents, content blocks, and relationships — which is defined by [Content model](./content-model.spec.md);
- the retrieval interface — the specific queries by which blocks are retrieved by ID, by properties, or by text, and by which relationships are traversed — which is defined by [Content-first retrieval](./content-first-retrieval.spec.md);
- the specific tools within each category — except for `update_working_memory`, which is defined in [Working memory](#working-memory). Specific tools for avatar interaction, UI control, and knowledge base access are defined by their respective domain specifications;
- the Guide's personality, private notes, and annotations — which are defined by [Annotations](./annotations.spec.md).

Where this specification depends on behaviour defined by those specifications, it links to them and states its requirement in terms of their observable behaviour.

## Events

### High-level semantic events

The UI produces high-level semantic events rather than exposing low-level UI events to the Guide. A high-level semantic event represents a meaningful user action or interface state change — for example, a document being opened, or attention being drawn to a block — rather than a raw input event such as a click or keystroke.

The specific event types and their payloads are defined by the UI specification. This specification governs the structure, queueing, flushing, and triggering behaviour that applies to all event types uniformly.

### Event structure

Every event must carry:

- **type** — the event type, from the controlled vocabulary established by [User interface](./ui.spec.md);
- **timestamp** — the time at which the event occurred;
- **payload** — event-type-specific data describing the event.

An event is immutable once produced: its type, timestamp, and payload must not change after creation.

### Event sources

Events are produced by the UI in response to User activity. The Guide does not produce events; the Guide consumes them. Guide-initiated actions (tool calls) produce their effects through the [Three-way interaction](./three-way-interaction.spec.md) model, not through the event system.

## Event queue

Events accumulate in an event queue. The event queue is the buffer between event production and interaction triggering.

- Events must be added to the queue in the order they are produced.
- The queue must preserve event ordering: events must be presented to the Guide in the order they were produced.
- When an interaction is triggered, the current contents of the queue are sent to the model as the event queue component of the interaction input, as defined in [Interaction input](#interaction-input).
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

- an event type with probability 1.0 always triggers a flush when added — for example, a direct address from the User, or the `session_start` event marking the Visitor's arrival, as defined by [User interface](./ui.spec.md#session-start);
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

  Scenario: Session start triggers the Guide's first interaction
    Given the frontend has completed bootstrap and the event queue is empty
    When a session_start event with trigger probability 1.0 is added
    Then the queue must be flushed
    And the session_start event must be the sole event in the flush
    And the flush must trigger the Guide's first interaction
    Because the Visitor arriving at the Archive is Visitor activity, as defined by [User interface](./ui.spec.md#session-start)

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

A flush of the event queue triggers an interaction. The interaction receives the flushed event queue as part of its input, as defined in [Interaction input](#interaction-input).

- Each flush triggers at most one interaction.
- The probability of a flush, and therefore of triggering an interaction, is determined by the trigger probability of the event type being added.
- An interaction trigger does not guarantee that the Guide will respond: the Guide may return FINISHED without issuing any tool calls, as defined in [FINISHED](#finished).
- At most one interaction is in progress at any time. There are no concurrent interactions. A high-probability event (e.g. direct address) produced during an interaction does not interrupt it; its roll is deferred and is guaranteed to trigger a flush once the interaction completes, as defined in [Queue lifecycle](#queue-lifecycle).

## Agentic model

The Guide operates as an agent driven by events from the UI. This section defines the agentic model: how events trigger interactions, what the model receives, and how it responds.

### Interaction input

When an interaction is triggered, the model receives:

- the **event queue** — the accumulated events that have not yet been consumed by an interaction, as flushed by the [Flush policy](#flush-policy);
- a **status object** — describing the current state of the interaction and the Guide's context.

The status object must include:

- the **budget** for this interaction, as defined in [Budget](#budget);
- the **working memory** — an arbitrary JSON value persisted across interactions, as defined in [Working memory](#working-memory);
- any **undispatched tool calls** from the immediately previous interaction — tool calls that could not be dispatched and are made available to the model to reissue or discard, as defined in [Undispatched tool calls](#undispatched-tool-calls).

The status object may include additional fields as defined by other specifications or implementation.

### Model output

The model responds entirely through tool calls. Free text is not permitted: the model must not produce output that is not a tool call or the FINISHED control signal.

The model's output in a turn is one of:

- one or more **tool calls** — executed and, where possible, dispatched in parallel, with their results returned for the next turn;
- **FINISHED** — the control signal that ends the interaction, as defined in [FINISHED](#finished).

There is no free-text output mode. The Guide communicates with the User exclusively through avatar and user interaction tools.

### Turns

A **turn** is one inference cycle within an interaction: the model is invoked with the interaction input (for the first turn) or the previous turn's tool results (for subsequent turns), and produces tool calls or FINISHED.

Tool calls produced in a turn are dispatched in parallel where possible. The cost of a turn is the sum of the costs of the tool calls dispatched in it, as defined in [Budget](#budget). Turns are not themselves counted toward the budget; only tool call costs are.

An interaction spans one or more turns. An interaction begins when triggered and ends when the model returns FINISHED or the budget is exhausted, as defined in [Budget](#budget).

## The Guide as a constrained actor

The Guide is an LLM-based actor with constrained capabilities, not a conventional chatbot. The constraints that distinguish the Guide from an unconstrained chatbot are normative:

- the Guide responds entirely through tool calls; free text is not permitted, as defined in [Model output](#model-output);
- the Guide may only invoke tools within the four categories defined in [Tool categories](#tool-categories);
- the Guide operates within a cost-based budget that bounds each interaction, as defined in [Budget](#budget);
- the Guide does not have free-form control over the Archive interface or unconstrained access to Archive content.

The Guide's responses to the User are produced within these constraints. The constraints are not advisory; an implementation must enforce them.

## Tool-call discipline

The Guide responds entirely through tool calls. Free text is not permitted: the model's output in every turn must be tool calls or FINISHED, and must not include free-text content.

- A tool call is the only mechanism by which the Guide may read Archive content, traverse relationships, control the UI, interact with the User via its avatar, or modify its own state.
- The Guide must not, through any tool call, assert facts about Archive content without having retrieved that content through a prior knowledge base access tool call, except where the content is provided directly as part of the interaction's input (the event queue or status object).

The three-way interaction model defines which of the Guide's actions are visible to the User and which are not: avatar interaction and UI control operations are visible, while knowledge base access and agent self operations are not. See [Three-way interaction](./three-way-interaction.spec.md).

## Tool categories

The Guide's tools fall into four broad categories. This specification defines the taxonomy and the constraints that apply to each category. Specific tools within each category — except for `update_working_memory`, defined in [Working memory](#working-memory) — are defined by their respective domain specifications.

### Avatar and user interaction

Tools that control the Guide's avatar and provide direct interaction with the User. This includes tools by which the Guide addresses the User with text, gestures, or other avatar-mediated communication.

- These tools are the only mechanism by which the Guide may communicate with the User, since free text is not permitted as model output.
- Tools in this category must not alter the Archive, the UI's navigation or attention state, or any persistent state other than the avatar's own presentation.

Specific tools in this category are defined by their domain specification.

### UI control

Tools that control the Archive interface. This includes navigation between documents and content blocks, and drawing the User's attention to material.

- Tools in this category produce visible interface changes.
- Tools in this category are subject to the User precedence rules defined by [Three-way interaction](./three-way-interaction.spec.md). A UI control tool call that conflicts with a User action must yield, and must not override a navigation or attention state established by the User.

Specific tools in this category are defined by their domain specification.

### Knowledge base access

Tools that access the underlying knowledge base. This includes retrieving content blocks by ID, by selected properties, or by textual content, and traversing relationships between blocks.

- Tools in this category must not produce visible interface changes. They return content to the Guide for use in reasoning and response.
- Tools in this category must not alter the Archive or any persistent state. They are read-only with respect to the knowledge base.

The retrieval interface is defined by [Content-first retrieval](./content-first-retrieval.spec.md).

### Agent self

Tools that affect the agent itself. This category includes `update_working_memory`, defined in [Working memory](#working-memory), and `safety_consult`, defined by [Agent safety](./agent-safety.spec.md), and may include other tools that affect the Guide's own state.

- Tools in this category must not alter the Archive, the UI, or the User's experience directly. They affect the agent's internal state only.
- The specific tools in this category, other than `update_working_memory` and `safety_consult`, are defined by their respective domain specifications.

### Prohibited tools

The Guide must not invoke any tool that does not fall within the four categories above. Any tool call outside the taxonomy must be rejected.

```gherkin
Feature: Tool categories
  Rule: The Guide may only invoke tools within the four categories

  Scenario: Prohibited tool
    Given the Guide issues a tool call of category "archive-mutation"
    And "archive-mutation" is not one of the four permitted categories
    When the call is processed
    Then the call must be rejected
    And no effect must occur
```

## Working memory

The Guide has a working memory: an arbitrary JSON value that persists across interactions. Working memory is the Guide's mutable state, distinct from the Archive's immutable record and from the Guide's annotations (which are defined by [Annotations](./annotations.spec.md)).

### Status field

The status object sent to the model includes a `working_memory` field, as defined in [Interaction input](#interaction-input). This field contains the current working memory value — an arbitrary JSON value. The model may read this value to inform its decisions.

### `update_working_memory`

The `update_working_memory` tool is the only mechanism by which the Guide may modify its working memory. It is a tool in the [Agent self](#agent-self) category.

- **Parameters** — the new JSON value, which replaces the current working memory in its entirety.
- **Effect** — the working memory value is replaced by the parameter value. The replacement takes effect for the next interaction: the updated value appears in the status object of the subsequent interaction.
- **Semantics** — the replacement is total, not partial. The tool does not merge or patch; it replaces the entire value. If the model wishes to modify part of the value, it must read the current value from the status object, compute the modified value, and issue `update_working_memory` with the full replacement.
- **No side effects** — `update_working_memory` must not alter the Archive, the UI, or any state other than working memory.

### Persistence and scope

Working memory persists across interactions. Unlike the budget (which is per-interaction with policy-based carryover), working memory has no fixed expiry: it is retained until replaced by a subsequent `update_working_memory` call.

- Working memory is scoped to the Guide. It is not shared with the User or the Archive.
- Working memory is not visible to the User. It is part of the Guide's internal state.
- Working memory is not part of the Archive's record.

#### Cross-visit persistence

Whether working memory survives a reset of the Guide's state (e.g. a page reload or the end of a browser visit) is governed by the session model's per-tier persistence policy, established by [Usage and deployment](./usage-and-deployment.spec.md#session-model): a tier whose persistence policy is **persistent** retains working memory across visits for the same browser; a tier whose policy is **ephemeral** discards it at visit end.

This specification owns the mechanism by which working memory persistence is realised:

- The working memory value is the unit of persistence. When the Guide's state is reset at the end of a visit, the current working memory value is the candidate for retention; on the next visit, a persistent tier restores that value as the Guide's initial working memory, and an ephemeral tier starts with no working memory (or an implementation-defined initial value).
- Persistence is per-browser, not per-account: there are no accounts, so the browser is the scope of persistence. Clearing site data resets persisted working memory regardless of tier.
- The specific storage location (e.g. IndexedDB) and the carryover shape are implementation concerns; this specification requires that a persistent tier restores the prior working memory value on a return visit and that an ephemeral tier does not.

The budget carryover, if persisted, follows the same per-tier policy; its carryover shape (`min(spent, remaining)`, as defined in [Budget](#budget)) is owned by this specification.

```gherkin
Feature: Working memory
  Rule: Working memory persists across interactions and is replaced wholesale; cross-visit persistence is per-tier

  Scenario: Working memory persists to the next interaction
    Given the Guide issues update_working_memory with value {"topic": "ceph-biology"}
    When the next interaction is triggered
    Then the status object must include working_memory with value {"topic": "ceph-biology"}

  Scenario: Working memory is replaced, not merged
    Given the current working memory is {"topic": "ceph-biology", "depth": 2}
    When the Guide issues update_working_memory with value {"topic": "cephalopods"}
    Then the working memory must be {"topic": "cephalopods"}
    And the "depth" key must not be present

  Scenario: Persistent tier restores working memory on return visit
    Given a Visitor in a persistent tier has working memory W at the end of a visit
    When the Visitor returns in the same browser
    Then the Guide's initial working memory must be W

  Scenario: Ephemeral tier discards working memory at visit end
    Given a Visitor in an ephemeral tier has working memory W at the end of a visit
    When the Visitor returns in the same browser
    Then the Guide must start without W
```

## Reasoning

The Guide reasons internally between tool calls. Reasoning is the Guide's internal process of interpreting retrieved content, deciding what to retrieve next, and composing a response.

- Reasoning occurs within turns and is not directly observable. The model's reasoning is internal to the inference cycle; only the resulting tool calls (or FINISHED) are acted upon.
- Reasoning is not visible to the User. Only the effects of avatar interaction and UI control tools are observable by the User.

Reasoning allows the Guide to navigate the Archive step by step — retrieving a block in one turn, reasoning about its relationships, retrieving related blocks in a further turn — rather than requiring all content to be available before reasoning begins.

## FINISHED

FINISHED is a control signal indicating that the model has completed its output for a turn without issuing further tool calls. It ends the interaction.

FINISHED is an abstraction over the underlying model provider's completion signal. For example, in the OpenAI Chat Completion API, FINISHED corresponds to `finish_reason: "stop"`. The specific representation varies by provider; this specification requires only that the implementation maps the provider's completion signal to FINISHED and treats it uniformly.

- When the model returns FINISHED, the interaction ends immediately. No further turns are executed.
- FINISHED is not a tool call: it produces no effect on the Archive or the interface. It is a control signal only.
- The model may return FINISHED at any point in an interaction, including before issuing any tool calls (declining to act) and after issuing one or more tool calls.

Returning FINISHED is the normal mechanism by which the Guide declines to respond to an event, as permitted by [Three-way interaction](./three-way-interaction.spec.md).

```gherkin
Feature: FINISHED
  Rule: FINISHED ends the interaction and produces no effect

  Scenario: FINISHED after tool calls
    Given the Guide has issued avatar interaction and UI control tool calls in earlier turns
    When the model returns FINISHED
    Then the interaction must end
    And no further turns must be executed

  Scenario: FINISHED with no tool calls
    Given an interaction has been triggered
    When the model returns FINISHED in the first turn
    Then the interaction must end
    And no tool calls must have been executed
    And no effect must occur on the Archive or interface
```

## Budget

Each Guide interaction is bounded by a cost-based budget. The budget bounds the total cost of tool calls within an interaction, and thereby bounds the cost and duration of an individual interaction. This specification owns both the budget mechanism and the budget policy: the budget composition, the cost assigned to each tool call type, and the overspend and carryover mechanisms.

### Cost model

Different tool calls have different costs. The cost of a turn is the sum of the costs of the tool calls dispatched in that turn. The budget is consumed cumulatively by the cost of each tool call dispatched across all turns within the interaction.

- Turns are not counted toward the budget; only tool call costs are.
- Tool calls dispatched in parallel within a turn each consume their own cost.
- The specific cost assigned to each tool call type is a policy parameter, as defined in [Policy parameters](#policy-parameters).
- Different tool categories may have different cost profiles: knowledge base access tools may have costs proportional to the amount of content retrieved, while avatar interaction tools may have fixed costs.
- The specific cost model — whether costs are fixed per tool type, variable based on parameters, or a combination — is a policy parameter.
- The cost of each tool must be included in the tool's definition sent to the model as part of the system prompt. This makes costs visible to the model at decision time, allowing it to weigh the cost of a tool call against the remaining budget when choosing whether and how to act.

### Budget status

The budget for the current interaction is included in the status object sent to the model, as defined in [Interaction input](#interaction-input). The model must be able to observe the remaining budget to inform its decisions.

The cost of each tool is included in the tool's definition sent to the model as part of the system prompt, as defined in [Cost model](#cost-model). This makes tool costs visible to the model alongside the remaining budget, allowing it to weigh cost against budget when choosing whether and how to act.

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

### Exhaustion

When the budget is exhausted, the following rules apply:

- no further tool calls must be dispatched after the budget is exhausted;
- the interaction must end;
- the Guide's response to the User up to that point — any avatar interaction calls already issued — stands. The implementation must not produce a partial or incoherent response on the Guide's behalf.

If the budget is exhausted before the Guide has issued any avatar interaction call, the interaction ends without a User-visible response. This is permitted: the Guide may decline to respond, and budget exhaustion is one mechanism by which that occurs.

```gherkin
Feature: Budget
  Rule: The budget bounds tool call costs, with policy-based overspend and carryover

  Scenario: Budget exhausted mid-interaction
    Given the Guide has dispatched tool calls consuming the full budget
    When the Guide attempts a further tool call
    Then the tool call must not be dispatched
    And the interaction must end
    And any avatar interaction calls already issued must stand

  Scenario: FINISHED before budget exhaustion
    Given the Guide has remaining budget
    When the model returns FINISHED
    Then the interaction must end
    And the remaining budget must be handled by the carryover policy
```

### Overspend

A tool call may cause the cumulative cost to exceed the budget — for example, when a tool call's cost is not known precisely until dispatch. The overspend policy determines whether such a call is dispatched.

The Guide accumulates a non-negative **pressure** value across interactions that records recent overspend. Pressure is a decaying accumulator: it grows when an interaction overspends and decays when an interaction is frugal, so sustained frugal behaviour relieves pressure while sustained overspend raises it. Pressure is defined in [Pressure](#pressure).

Whether a tool call that would exceed the budget is dispatched is determined by a **probabilistic overspend gate** applied at the moment of dispatch. The gate computes the pressure that _would_ result if the overspend were permitted — i.e. the current pressure halved (its decay step) plus the proposed overspend — and scales that against the budget base. For a proposed overspend $o$ (the amount by which the call would exceed the remaining budget) given current pressure $p$ and the budget base $b$, the probability that the call is permitted is:

$$\text{probability\_allowed} = \sigma\!\left(1 - \frac{\lfloor p/2 \rfloor + o}{b}\right)$$

where $\sigma$ is the logistic sigmoid. The numerator $\lfloor p/2 \rfloor + o$ is exactly the pressure that would be recorded at the end of the interaction if this overspend were permitted (the pressure decay step applied to the current pressure, plus the overspend amount), so the gate compares the prospective resulting pressure to the budget base.

- The gate is applied per attempted overspend. A roll against $\text{probability\_allowed}$ determines whether the call is dispatched.
- If the roll succeeds, the call is dispatched and its cost consumed, increasing the interaction's overspend.
- If the roll fails, the call is not dispatched and becomes an undispatched tool call, as defined in [Undispatched tool calls](#undispatched-tool-calls); the interaction ends via the exhaustion path, as defined in [Exhaustion](#exhaustion).
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

## Undispatched tool calls

A tool call may fail to dispatch — for example, because its target could not be resolved, a service was unavailable, or the budget was exhausted before dispatch. Undispatched tool calls from the immediately previous interaction are included in the status object sent to the model for the next interaction, as defined in [Interaction input](#interaction-input).

- The model may choose to reissue an undispatched tool call in the new interaction, or may discard it.
- Undispatched tool calls are informational: the model is not required to reissue them, and discarding them must not produce an error.

## Policy parameters

The agentic model is governed by a set of policy parameters. This specification defines the parameters that must exist and their required properties; the specific values are implementation-defined and may be configurable. The cross-cutting structural contract that all policy parameters satisfy — that they must exist, have defined values, and conform to their type — is established by [Policy and configuration](./policy-and-configuration.spec.md). The delivery mechanism by which values are read, resolved, and provided to subsystems is established by [Usage and deployment](./usage-and-deployment.spec.md#application-configuration-api).

The following policy parameters must be defined:

| Parameter                          | Description                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Trigger probability per event type | The probability of flushing when an event of that type is added to the queue, in the range [0.0, 1.0].           |
| Budget base                        | The fixed budget amount assigned to every interaction; also the denominator of the probabilistic overspend gate. |
| Budget premium function            | The function that determines the premium based on the event types in the flushed queue.                          |
| Tool call costs                    | The cost assigned to each tool call type.                                                                        |
