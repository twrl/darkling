# Three-way interaction model

## Purpose and scope

This specification defines the three-way interaction model that is the central experiential feature of Darkling: the interaction between the **User**, the **Archive**, and the **Guide**.

It governs:

- the roles of the three actors;
- the capabilities each actor has with respect to the others;
- the protocols by which they interact;
- the shared control of the Archive's interface, including conflict resolution between the User and the Guide;
- the characterisation of the Guide's autonomy and responsiveness.

It is explicitly out of scope for this specification to define:

- the agentic model that produces high-level semantic events, including the event queue and per-event probabilistic flush policy — see [Constrained agent](./constrained-agent.spec.md);
- the mechanism by which the Guide's budget is enforced, and the constrained agent's tool-call discipline — see [Constrained agent](./constrained-agent.spec.md);
- the content model and content-first retrieval — see [Content model](./content-model.spec.md) and [Content-first retrieval](./content-first-retrieval.spec.md);

Where this specification depends on behaviour defined by those specifications, it links to them and states its requirement in terms of their observable behaviour, without redefining their mechanisms.

## Actors

The system has three actors. Each has a distinct role and a distinct set of capabilities.

### User

The User is the human exploring the Archive in the company of the Guide.

The User:

- explores Archive material directly by navigating between documents and opening content;
- may address the Guide with queries and responses;
- manipulates the Archive's interface directly.

The User is the principal agent of the interaction. The User's actions take precedence over the Guide's actions on the Archive interface, as defined in [Interface control](#interface-control).

### Archive

The Archive is the body of interconnected fictional material together with the interface that presents it.

The Archive:

- presents content as addressable content blocks with structural metadata and typed relationships, as defined by [Content model](./content-model.spec.md);
- exposes a set of interface operations that may be invoked by both the User and the Guide;
- is the shared substrate of the interaction: the User and the Guide both act upon it, and it is the principal medium through which the Guide is able to draw attention to material and respond to the User's activity.

The Archive is passive with respect to agency: it does not initiate interaction. It responds to operations invoked upon it.

### Guide

The Guide is an LLM-based actor with an authored personality that accompanies the User through the Archive.

The Guide:

- interacts with the Archive exclusively through tool calls, as defined by [Constrained agent](./constrained-agent.spec.md);
- may manipulate the Archive's interface within the permitted actions defined in [Interface control](#interface-control);
- has access to private, topic-linked notes and recollections represented as annotations on Archive content, rather than as mutable model memory;
- is an actor with constrained capabilities, not a conventional chatbot: it does not have free-form control over the interface or unconstrained access to Archive content.

The Guide's subjective perspective — opinions, affective cues, and private recollections — is expressed through its responses and annotations and is not part of the Archive's underlying record.

## Interaction protocols

Interaction proceeds over the following directed channels.

### User → Archive

The User manipulates the Archive directly. User actions on the Archive are reflected immediately in the interface and are not subject to the Guide's approval or mediation.

### User → Guide

The User may address the Guide with queries and responses. A User address to the Guide is a direct input that the Guide must acknowledge and respond to within the bounds of its budget, as defined by [Constrained agent](./constrained-agent.spec.md#budget).

### Guide → Archive

The Guide manipulates the Archive exclusively through tool calls drawn from the permitted actions defined in [Interface control](#interface-control). The Guide must not manipulate the Archive through any channel other than these tool calls.

### Guide → User

The Guide addresses the User through responses and observations. The Guide may draw the User's attention to Archive material, either by manipulating the interface or by referring to material within its responses.

## Interface control

Both the User and the Guide may manipulate the Archive's interface. This is a defining feature of the three-way model: the Guide is able to draw attention to material, navigate between documents, and respond to the User's activity rather than only answering questions.

### Permitted Guide actions

The Guide may invoke the following categories of interface operation upon the Archive:

- **Navigate** — move the interface to present a specific document or content block.
- **Draw attention** — emphasise or highlight material within the currently presented content, to direct the User's attention.
- **Retrieve** — retrieve content blocks directly by ID, by selected properties, or by textual search, and traverse relationships between blocks, as defined by [Content-first retrieval](./content-first-retrieval.spec.md).

The Guide must not invoke any interface operation outside these categories. Any further capability must be established by an extension to this specification or by a specification that this specification references.

Retrieval operations produce content for the Guide's own reasoning and response and are not, by themselves, interface manipulations visible to the User; navigation and attention operations are visible to the User as changes to the presented interface.

### Conflict resolution

When the User and the Guide act upon the Archive interface such that their actions conflict, the following rules apply:

1. **User precedence.** The User's actions take precedence over the Guide's actions. A User action that conflicts with an in-flight or pending Guide action must cause the Guide's action to yield.
2. **Non-preemptive User actions.** A User action must not be preempted, reverted, or delayed by a Guide action. The Guide must not override a navigation or attention state established by the User.
3. **Guide continuity.** Where the Guide's action is preempted by a User action, the Guide may acknowledge the interruption within its response, but must not reassert the preempted action against the User's established state.

These rules establish the User as the principal agent of the interaction while preserving the Guide's ability to act autonomously when not in conflict with the User.

```gherkin
Feature: Interface conflict resolution
  Rule: User actions take precedence over Guide actions

  Scenario: Guide navigates while User is navigating
    Given the User has initiated navigation to document A
    And the Guide issues a tool call to navigate to document B
    When the actions conflict
    Then the Guide's navigation to document B must yield
    And the interface must present document A

  Scenario: User navigates away from Guide's attention
    Given the Guide has drawn attention to a block in document A
    When the User navigates to document B
    Then the User's navigation must not be preempted or delayed
    And the Guide's attention state must not be reasserted over document B
```

## Guide autonomy and responsiveness

The Guide must appear responsive and autonomous while remaining an LLM operating within a structured interactive system. This specification establishes the observable requirements that produce that appearance; the mechanisms that satisfy them are defined by the referenced specifications.

### Apparent spontaneity

The Guide's actions must not appear to be uniformly triggered by each discrete user input. To this end:

- the Guide's responses to User activity must exhibit variable timing, so that the Guide appears to respond with spontaneous timing rather than as a deterministic reflex;
- the mechanism that produces variable timing is the per-event probabilistic flush policy of the agentic model, defined by [Constrained agent](./constrained-agent.spec.md#flush-policy).

This specification requires the observable property of apparent spontaneity; it does not prescribe the flush policy itself.

### Bounded interaction

Each Guide interaction must be bounded in cost and duration:

- the Guide operates within an explicit budget that bounds the cost of tool calls of an individual interaction, as defined by [Constrained agent](./constrained-agent.spec.md#budget);
- the Guide may not exceed its budget, and must produce a response to the User within the bounds of the current interaction.

### Responsiveness to activity

The Guide must be able to respond to the User's activity in the Archive, not only to direct addresses. That is, the Guide may initiate observations or interface manipulations in response to high-level semantic events produced by the User's navigation and attention, as defined by [Constrained agent](./constrained-agent.spec.md#events), subject to the conflict resolution rules in [Interface control](#interface-control).

```gherkin
Feature: Guide responsiveness
  Rule: The Guide responds to both direct addresses and Archive activity

  Scenario: Guide responds to a direct query
    Given the User has addressed the Guide with a query
    When the Guide's interaction is processed
    Then the Guide must acknowledge and respond to the query
    And the response must be produced within the current turn budget

  Scenario: Guide observes User activity
    Given the User has opened a document producing a document_opened event
    And no direct address to the Guide has been made
    When the agentic model flushes the event
    Then the Guide may respond with an observation or interface manipulation
    But the Guide may also decline to respond

  Scenario: Guide timing is not deterministic
    Given the User has performed a sequence of equivalent actions
    When the Guide's responses are observed
    Then the timing of the responses must vary
    And the responses must not appear uniformly triggered by each action
```

## Conformance

An implementation conforms to this specification when:

- the three actors are distinguished with the capabilities defined in [Actors](#actors);
- interaction proceeds only over the channels defined in [Interaction protocols](#interaction-protocols);
- the Guide's interface manipulations are confined to the permitted actions in [Interface control](#interface-control);
- interface conflicts are resolved according to the rules in [Conflict resolution](#conflict-resolution);
- the Guide exhibits the apparent spontaneity and bounded interaction properties defined in [Guide autonomy and responsiveness](#guide-autonomy-and-responsiveness).
