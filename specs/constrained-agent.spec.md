# Constrained agent

## Purpose and scope

This specification defines the Guide as a constrained agent: the discipline by which the Guide operates as an LLM-based actor with bounded capabilities, including the agentic model by which events trigger interactions, the Guide's exclusive use of tool calls (with no free text), the tool category taxonomy, the FINISHED control signal, the cost-based budget that bounds individual interactions, and the working memory mechanism for cross-interaction state.

It governs:

- the agentic model: events, the event queue, probabilistic interaction triggering, and the status object sent to the model;
- the Guide's status as a constrained actor rather than a conventional chatbot;
- the tool-call discipline: the Guide responds entirely through tool calls; free text is not permitted;
- the four tool categories and their taxonomy;
- the `update_working_memory` tool and the `working_memory` status field;
- the FINISHED control signal;
- the cost-based budget, including overspend and carryover policies.

It is explicitly out of scope for this specification to define:

- the three-way interaction model — the roles of the User, Archive, and Guide, the interaction channels, and interface conflict resolution — which are defined by [Three-way interaction](./three-way-interaction.spec.md);
- the event system that triggers the Guide, including microbatching and the hybrid immediate/probabilistic flush policy — which is defined by [Event system](./event-system.spec.md);
- the content model — documents, content blocks, and relationships — which is defined by [Content model](./content-model.spec.md);
- the specific tools within each category — except for `update_working_memory`, which is defined in [Working memory](#working-memory). Specific tools for avatar interaction, UI control, and knowledge base access are defined by their respective domain specifications;
- the retrieval interface — the specific queries by which blocks are retrieved by ID, by properties, or by text, and by which relationships are traversed — which is defined by [Content-first retrieval](./content-first-retrieval.spec.md);
- the Guide's personality, private notes, and annotations — which are defined by [Annotations](./annotations.spec.md).

Where this specification depends on behaviour defined by those specifications, it links to them and states its requirement in terms of their observable behaviour.

## Agentic model

The Guide operates as an agent driven by events from the UI. This section defines the agentic model: how events trigger interactions, what the model receives, and how it responds.

### Events and the event queue

The UI produces events. Each event is added to an event queue. The nature of events — including the high-level semantic events such as `document_opened` referenced by [Three-way interaction](./three-way-interaction.spec.md) — and the microbatching and hybrid immediate/probabilistic flush policy of the queue are defined by [Event system](./event-system.spec.md).

This specification requires:

- events accumulate in the event queue until an interaction is triggered;
- when an interaction is triggered, the current event queue is sent to the model as part of the interaction's input.

### Probabilistic triggering

Each event has a probability, depending on its type, of triggering an interaction. Not every event triggers an interaction; whether an event triggers one is probabilistic.

This produces the apparent spontaneity required by [Three-way interaction](./three-way-interaction.spec.md): the Guide's responses are not uniformly triggered by each discrete event, but exhibit variable timing. The specific probabilities and the event-type-dependent triggering policy are defined by [Event system](./event-system.spec.md).

### Interaction input

When an interaction is triggered, the model receives:

- the **event queue** — the accumulated events that have not yet been consumed by an interaction;
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

Tools that affect the agent itself. This category includes `update_working_memory`, defined in [Working memory](#working-memory), and `safety_consult`, defined in [Agent safety](./agent-safety.spec.md), and may include other tools that affect the Guide's own state.

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
- Working memory is not part of the Archive's record. It does not survive a reset of the Guide's state beyond what implementation policy defines.

```gherkin
Feature: Working memory
  Rule: Working memory persists across interactions and is replaced wholesale

  Scenario: Working memory persists to the next interaction
    Given the Guide issues update_working_memory with value {"topic": "ceph-biology"}
    When the next interaction is triggered
    Then the status object must include working_memory with value {"topic": "ceph-biology"}

  Scenario: Working memory is replaced, not merged
    Given the current working memory is {"topic": "ceph-biology", "depth": 2}
    When the Guide issues update_working_memory with value {"topic": "cephalopods"}
    Then the working memory must be {"topic": "cephalopods"}
    And the "depth" key must not be present
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

Each Guide interaction is bounded by a cost-based budget. The budget bounds the total cost of tool calls within an interaction, and thereby bounds the cost and duration of an individual interaction.

### Cost model

Different tool calls have different costs. The cost of a turn is the sum of the costs of the tool calls dispatched in that turn. The budget is consumed cumulatively by the cost of each tool call dispatched across all turns within the interaction.

- Turns are not counted toward the budget; only tool call costs are.
- Tool calls dispatched in parallel within a turn each consume their own cost.
- The specific cost assigned to each tool call type, and the budget amount, are defined by policy as established by [Event system](./event-system.spec.md) or implementation. This specification requires that a budget exists and is consumed by tool call costs.

### Budget status

The budget for the current interaction is included in the status object sent to the model, as defined in [Interaction input](#interaction-input). The model must be able to observe the remaining budget to inform its decisions.

The cost of each tool is included in the tool's definition sent to the model as part of the system prompt, as defined by [Event system](./event-system.spec.md). This makes tool costs visible to the model alongside the remaining budget, allowing it to weigh cost against budget when choosing whether and how to act.

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

A tool call may cause the cumulative cost to exceed the budget — for example, when a tool call's cost is not known precisely until dispatch. When this occurs, the overspend must be handled by a policy-based mechanism.

This specification requires that an overspend mechanism exists. The specific overspend policy — including whether overspend is permitted, by how much, and what happens to the interaction — is defined by policy and is out of scope for this specification.

### Carryover

Unspent budget may be carried over into future interactions. When an interaction ends with remaining budget, the carryover policy determines how (if at all) that remaining budget is applied to subsequent interactions.

This specification requires that a carryover mechanism exists. The specific carryover policy — including how much budget is carried over, for how long, and how it combines with the next interaction's fresh budget — is defined by policy and is out of scope for this specification.

Carryover is a deliberate departure from a strictly per-interaction budget: it allows the Guide to accumulate budget when it is quiet and spend it when active, contributing to the apparent autonomy required by [Three-way interaction](./three-way-interaction.spec.md).

## Undispatched tool calls

A tool call may fail to dispatch — for example, because its target could not be resolved, a service was unavailable, or the budget was exhausted before dispatch. Undispatched tool calls from the immediately previous interaction are included in the status object sent to the model for the next interaction, as defined in [Interaction input](#interaction-input).

- The model may choose to reissue an undispatched tool call in the new interaction, or may discard it.
- Undispatched tool calls are informational: the model is not required to reissue them, and discarding them must not produce an error.
- Only tool calls from the immediately previous interaction are included; undispatched tool calls do not accumulate across multiple interactions.

```gherkin
Feature: Undispatched tool calls
  Rule: Undispatched tool calls from the previous interaction are offered to the model

  Scenario: Model reissues an undispatched tool call
    Given the previous interaction ended with an undispatched knowledge base access call
    When the next interaction is triggered
    Then the status object must include the undispatched call
    And the model may reissue the call

  Scenario: Model discards an undispatched tool call
    Given the previous interaction ended with an undispatched UI control call
    When the next interaction is triggered
    Then the status object must include the undispatched call
    And the model may return FINISHED without reissuing it
    And no error must occur
```

## Conformance

An implementation conforms to this specification when:

- events accumulate in an event queue and are sent to the model when an interaction is triggered;
- each event has a type-dependent probability of triggering an interaction;
- the model receives the event queue and a status object including the budget, working memory, and any undispatched tool calls from the previous interaction;
- the model responds entirely through tool calls or FINISHED; free text is not permitted;
- the Guide may only invoke tools within the four tool categories (avatar and user interaction, UI control, knowledge base access, agent self), and prohibited tool calls are rejected;
- tool calls within a turn are dispatched in parallel where possible;
- the `update_working_memory` tool replaces the working memory value in its entirety, and the updated value appears in the next interaction's status object;
- FINISHED ends the interaction and produces no effect;
- the budget is cost-based, consumed by tool call costs, and bounds the interaction;
- budget overspend and carryover are handled by policy-based mechanisms;
- undispatched tool calls from the immediately previous interaction are included in the next interaction's status and may be reissued or discarded.
