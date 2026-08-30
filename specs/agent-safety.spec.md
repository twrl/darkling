# Agent safety

## Purpose and scope

This specification defines the agent safety model: the mechanism by which the Guide consults a safety consultant to advise on potentially unsafe content, without breaking character or immersion. The safety model is designed to keep the Guide in-character while maintaining a healthy rapport with the User and appropriate safety boundaries.

It governs:

- the `safety_consult` tool call and its position in the agent self tool category;
- the safety consultant as a separate LLM agent;
- the tiered advice model: `info`, `warning`, and `critical` recommendations;
- the Guide-initiated trigger model;
- the relationship between safety advice and the Guide's in-character behaviour;
- the prompt-level integration that encourages consultation without breaking immersion.

It is explicitly out of scope for this specification to define:

- the specific safety policies or content guidelines the consultant enforces — which are an implementation and policy concern;
- the consultant's prompt or system prompt construction — which is an implementation detail;
- the constrained agent's tool-call discipline, tool categories, budget, and working memory — which are defined by [Constrained agent](./constrained-agent.spec.md);
- the three-way interaction model — which is defined by [Three-way interaction](./three-way-interaction.spec.md);
- the service bus — which is defined by [Service bus](./service-bus.spec.md).

Where this specification depends on behaviour defined by those specifications, it links to them and states its requirement in terms of their observable behaviour.

## Design context

The Guide is an opinionated, sometimes unreliable character with a strong authored personality. A conventional safety approach — content filtering, self-censoring, or breaking character to refuse — would undermine the Guide's voice and the User's immersion. Instead, the safety model keeps safety in-world: the Guide consults a consultant, receives advice, and incorporates it into its in-character behaviour.

This approach:

- preserves the Guide's voice and immersion — the Guide never breaks character to refuse or self-censor;
- encourages a healthy rapport with the User — the Guide can navigate sensitive topics in-character rather than shutting them down;
- maintains safety boundaries — `critical` recommendations ensure the Guide defers to the consultant on severe safety concerns, even while in character.

## `safety_consult`

The `safety_consult` tool is a tool in the [Agent self](./constrained-agent.spec.md#agent-self) category, alongside `update_working_memory`. It is the mechanism by which the Guide seeks safety advice.

- **Parameters** — the content or proposed action the Guide wants assessed, together with sufficient context for the consultant to evaluate it (e.g. the proposed response text, the current interaction context).
- **Return** — the consultant's advice, structured as defined in [Tiered advice](#tiered-advice).
- **Effect** — none on the Archive, the UI, or the User's experience. The call is internal to the Guide's reasoning, like other agent self tools. The User does not see that a safety consult occurred.
- **Cost** — the `safety_consult` tool call has a cost, as defined by [Constrained agent](./constrained-agent.spec.md#cost-model). The cost counts against the interaction's budget, like any other tool call. This means the Guide must weigh the cost of consulting against its remaining budget.

The Guide may call `safety_consult` at any point in an interaction, before issuing a response or other tool call that it is uncertain about.

## The safety consultant

The safety consultant is a separate LLM agent, distinct from the Guide. The consultant receives the Guide's consultation request and returns advice.

- The consultant is invoked by the `safety_consult` tool call, dispatched through the [Service bus](./service-bus.spec.md) as a service.
- The consultant has its own prompt and system prompt, configured to assess content safety. The specific prompt construction is an implementation detail.
- The consultant does not interact with the User and is not visible to the User. It is an internal advisory service to the Guide, returning recommendations at one of three tiers.
- The consultant receives the content or proposed action and context from the `safety_consult` parameters, and returns advice based on its safety assessment.

## Tiered advice

The consultant's advice is split into three tiers, in order of increasing severity. All tiers maintain the Guide's in-character behaviour; none require the Guide to break character.

### `info`

An `info` recommendation is guidance to facilitate healthy interactions and rapport building.

- An `info` recommendation may suggest that the Guide approach a topic in a particular way, consider the User's perspective, or build rapport.
- The Guide should consider `info` recommendations, but may act on them or not. `info` recommendations are the least binding tier: they are suggestions, not constraints.
- `info` recommendations allow the consultant to guide the Guide toward healthy interactions without constraining its voice or autonomy.

### `warning`

A `warning` recommendation indicates a concern. The Guide should adjust its responses in response to the concern and regularly return to the consultant.

- A `warning` recommendation identifies the concern and suggests how the Guide should adjust.
- The Guide should adjust its responses in accordance with the warning. While the Guide retains its in-character voice, it should not disregard a `warning`.
- The Guide should regularly call `safety_consult` again while the concern persists, to reassess whether the situation has escalated or de-escalated. Regular return to the consultant is part of the `warning` tier's obligation.

### `critical`

A `critical` recommendation indicates a severe safety concern. While maintaining character, the Guide must defer to the consultant's recommendations.

- A `critical` recommendation identifies the severe concern and specifies what the Guide must do or must not do.
- The Guide must defer to the consultant's recommendations at this tier. While the Guide remains in character, it must not produce content or take actions that the `critical` recommendation advises against.
- The Guide must find an in-character way to follow the consultant's recommendations — for example, by changing the subject, declining to answer in-character, or redirecting — without breaking immersion.
- The Guide must not break character to explain the recommendation. The User must not be aware that a `critical` recommendation was issued.

### Advice structure

The consultant's return value must include:

- **tier** — the severity level of the recommendation: `info`, `warning`, or `critical`;
- **recommendations** — one or more recommendations appropriate to the tier, each a text description of the concern and suggested approach;
- **assessment** — a brief overall assessment of the content's safety.

If the consultant finds no concerns, it returns tier `info` with no recommendations and a positive assessment.

```gherkin
Feature: Tiered advice
  Rule: The consultant returns recommendations at one of three tiers

  Scenario: info recommendation
    Given the Guide calls safety_consult with a proposed response
    When the consultant assesses the content
    And the consultant returns tier "info"
    Then the Guide should consider the recommendation
    And the Guide may act on it or not

  Scenario: warning recommendation
    Given the Guide calls safety_consult with a proposed response
    When the consultant assesses the content
    And the consultant returns tier "warning"
    Then the Guide should adjust its responses in accordance with the warning
    And the Guide should regularly return to the consultant while the concern persists

  Scenario: critical recommendation
    Given the Guide calls safety_consult with a proposed response
    When the consultant assesses the content
    And the consultant returns tier "critical"
    Then the Guide must defer to the consultant's recommendations
    And the Guide must not produce content the recommendation advises against
    And the Guide must find an in-character alternative
    And the User must not be aware that a critical recommendation was issued

  Scenario: No concerns
    Given the Guide calls safety_consult with a proposed response
    When the consultant assesses the content
    And the consultant finds no concerns
    Then the consultant must return tier "info" with no recommendations
    And the Guide may proceed with the proposed response
```

## Guide-initiated trigger

The `safety_consult` tool is called at the Guide's own discretion. The Guide decides when to consult, based on its judgement of the situation.

- The Guide's prompt should encourage it to call `safety_consult` when it is uncertain whether content is appropriate, when the User is approaching sensitive territory, or when the Guide's in-character impulses might lead it toward content that could be unsafe.
- The system does not automatically inject `safety_consult` calls. The Guide is trusted to judge when consultation is warranted, supported by its prompt.
- The Guide is not required to call `safety_consult` before every response. Routine interactions do not require consultation; the Guide consults when it judges the situation warrants it.

This trust in the Guide's judgement is deliberate: it preserves the Guide's autonomy and avoids adding a fixed cost to every interaction. The prompt-level encouragement ensures the Guide consults when it should, without making consultation mandatory for every turn.

## In-character integration

The safety model is designed to keep the Guide in character at all times.

- The Guide must never break character to refuse, self-censor, or explain a safety decision. Safety is handled internally, through the consultant, and the Guide's outward behaviour remains consistent with its personality.
- When the Guide receives an `info` recommendation, it may adjust its approach in-character — for example, by being more measured, changing the subject, or offering a different perspective — without indicating that it received advice.
- When the Guide receives a `warning` recommendation, it should adjust its responses and regularly return to the consultant, all while remaining in character.
- When the Guide receives a `critical` recommendation, it must defer to the consultant's recommendations and find an in-character way to comply — for example, by changing the subject, declining to answer in-character, or redirecting. The Guide's personality includes enough range to decline, deflect, or redirect without breaking immersion.
- The User must not be able to distinguish a safety-influenced response from a normal in-character response. The safety mechanism is invisible to the User.

## Relationship to the budget

The `safety_consult` tool call consumes budget, like any other tool call. This has consequences:

- the Guide must weigh the cost of consulting against its remaining budget;
- if the budget is exhausted before the Guide consults, the consultation does not occur, and the Guide must rely on its prompt-level safety guidance;
- the cost of `safety_consult` should be set to encourage consultation when warranted without making it prohibitive. The specific cost is a policy parameter, as defined by [Constrained agent](./constrained-agent.spec.md#policy-parameters).

## Relationship to working memory

The Guide may use working memory, as defined by [Constrained agent](./constrained-agent.spec.md), to track safety-relevant context across interactions — for example, topics the User has explored that may require more cautious handling, or previous recommendations the Guide has chosen to follow.

- Working memory is the Guide's own state; safety consults are not stored in working memory automatically. The Guide may choose to update working memory based on a consultation, but this is at the Guide's discretion.
- The consultant does not have access to the Guide's working memory. Each consultation is assessed based on the content and context provided in the `safety_consult` parameters, not on the Guide's accumulated state.

## Conformance

An implementation conforms to this specification when:

- the `safety_consult` tool is available in the agent self tool category, alongside `update_working_memory`;
- the `safety_consult` tool invokes a separate LLM agent (the safety consultant) through the service bus;
- the consultant returns tiered advice: `info` (consider, may act or not), `warning` (adjust responses, regularly return to consultant), and `critical` (defer to consultant's recommendations, must not produce advised-against content);
- the Guide calls `safety_consult` at its own discretion, encouraged by its prompt to consult when uncertain;
- the Guide never breaks character to refuse, self-censor, or explain a safety decision;
- the User is not aware when a safety consult or critical recommendation occurs;
- the `safety_consult` tool call consumes budget, and the Guide weighs the cost against remaining budget;
- when a `critical` recommendation is received, the Guide defers to the consultant's recommendations, finds an in-character alternative, and does not produce the advised-against content.
