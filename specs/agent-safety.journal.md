# Journal: Agent safety

This journal records the development of [agent-safety.spec.md](./agent-safety.spec.md). It is non-normative; the specification takes precedence.

## Origin

Created as the ninth specification. The user proposed a `safety_consult` tool call in the agent self group that calls into a consultant agent, combined with prompt-level encouragement, to provide a safety mechanic without breaking immersion. Established via the specification workflow.

## Scope decisions

Through dialogue with the user, the following scope decisions were made:

- **Consultant: separate LLM agent.** The safety consultant is a distinct LLM agent with its own prompt, not a rule-based classifier. This allows nuanced assessment of content in context, rather than keyword matching. The consultant is invoked as a service on the service bus.
- **Advice: three tiers (info, warning, critical).** The consultant returns recommendations at one of three severity tiers, replacing the earlier advisory/binding model:
  - `info` — the Guide should consider this to facilitate healthy interactions and rapport building; may act on it or not (least binding).
  - `warning` — there is a concern; the Guide should adjust its responses and regularly return to the consultant to reassess.
  - `critical` — severe safety concern; while maintaining character, the Guide must defer to the consultant's recommendations and must not produce advised-against content.

  This three-tier model replaces the earlier two-tier advisory/binding split. It's more nuanced: `info` preserves the Guide's autonomy for healthy-interaction guidance, `warning` introduces an obligation to adjust and to keep consulting, and `critical` is the hard constraint. All three tiers maintain the Guide's in-character behaviour — none require breaking character. The `warning` tier's "regularly return to the consultant" obligation is a distinctive feature: it creates an ongoing monitoring loop for persistent concerns, rather than a single assessment.

- **Trigger: Guide-initiated.** The Guide calls `safety_consult` at its own discretion, encouraged by its prompt. The system does not auto-inject consultation calls. This preserves the Guide's autonomy and avoids a fixed cost on every interaction. The prompt-level encouragement is the mechanism for ensuring the Guide consults when it should.

## Key decisions and rationale

### Safety in-world, not breaking character

The core design principle is that the Guide never breaks character to refuse, self-censor, or explain a safety decision. The README describes the Guide as "an opinionated and sometimes unreliable character with its own perspective." A conventional safety approach (content filtering, refusals, self-censoring) would undermine this. Instead, the safety consultant is an internal mechanism: the Guide consults, receives advice, and incorporates it into its in-character behaviour. The User never sees that a consultation occurred.

This is the key insight from the user's proposal: safety doesn't have to mean breaking immersion. The Guide can navigate sensitive topics in-character, with the consultant providing behind-the-scenes guidance.

### Advisory notes preserve Guide autonomy

The `info` tier is non-binding. The Guide is encouraged (via prompt) to take `info` recommendations seriously, but may disregard them. This is deliberate: the Guide is an opinionated character, and forcing it to follow every recommendation would flatten its personality. For healthy-interaction guidance, the consultant nudges; the Guide decides. This allows the Guide to maintain its voice while being aware of rapport-building opportunities.

### Binding vetoes are hard constraints

The `critical` tier is not optional. When the consultant returns `critical`, the Guide must defer to the consultant's recommendations and must not produce advised-against content. This is a hard safety boundary. The Guide must find an in-character alternative — changing the subject, declining in-character, redirecting — without breaking immersion. The spec requires that the User cannot distinguish a `critical`-influenced response from a normal one.

The `warning` tier sits between these: the Guide should adjust its responses and regularly return to the consultant. This creates an ongoing monitoring loop for persistent concerns — the Guide doesn't just adjust once, it keeps consulting while the concern persists, allowing the situation to escalate to `critical` or de-escalate to `info`.

### Guide-initiated, not system-injected

The user chose Guide-initiated consultation over system-injected. This means:

- the Guide decides when to consult, based on its judgement of the situation;
- the system does not automatically call `safety_consult` before every response;
- the Guide's prompt encourages consultation when uncertain, but doesn't mandate it for every turn.

This preserves the Guide's autonomy and avoids adding a fixed cost to every interaction. The trade-off is that the Guide might not consult when it should — but the prompt-level encouragement is designed to mitigate this, and the Guide's in-character judgement is trusted.

### Budget cost encourages judicious use

The `safety_consult` tool call consumes budget. This means the Guide must weigh the cost of consulting against its remaining budget. If the budget is exhausted, the consultation doesn't occur, and the Guide falls back on its prompt-level safety guidance. The cost should be set to encourage consultation when warranted without being prohibitive — a policy parameter owned by the constrained agent spec (formerly the event system spec, now consolidated into it).

### Consultant has no access to working memory

Each consultation is assessed based on the content and context provided in the `safety_consult` parameters, not on the Guide's accumulated working memory. This keeps the consultant stateless and prevents the consultant from being influenced by the Guide's subjective state. The Guide may use working memory to track safety-relevant context across interactions, but this is the Guide's own decision, not the consultant's.

## Dependencies on other specifications

This specification references:

- [Constrained agent](./constrained-agent.spec.md) — for the agent self tool category, tool-call discipline, budget, and working memory. (The event system spec, formerly referenced separately for budget policy and tool call cost assignment, has been consolidated into the constrained agent spec.)
- [Service bus](./service-bus.spec.md) — for the dispatch of the `safety_consult` call to the consultant service.
- [Three-way interaction](./three-way-interaction.spec.md) — for the Guide's in-character behaviour and the User's experience.

All referenced specifications are established. The `safety_consult` tool is now listed in the constrained agent spec's agent self category alongside `update_working_memory`.

## Gaps and ambiguities

- **Safety policies.** The spec does not define the specific safety policies or content guidelines the consultant enforces. These are an implementation and policy concern, appropriate for configuration rather than specification.
- **Consultant prompt.** The spec does not define the consultant's prompt or system prompt. This is an implementation detail.
- **Cost of safety_consult.** The spec states the cost should encourage consultation without being prohibitive, but the specific cost is a policy parameter owned by the constrained agent spec.
- **Veto enforcement.** The spec states the Guide must not produce vetoed content, but does not define a mechanism for enforcing this at the system level (e.g. post-hoc content checking). Enforcement relies on the Guide's prompt and the binding nature of the veto. A system-level enforcement mechanism may be warranted.
- **Consultant availability.** The spec does not address what happens if the consultant service is unavailable (e.g. host failure). The service bus's error propagation would cause the `safety_consult` call to reject, but the Guide's behaviour in this case is not specified.
- **Multiple consultations.** The spec does not address whether the Guide may call `safety_consult` multiple times in a single interaction (e.g. consulting on different proposed responses). This is permitted by the tool-call model but not explicitly stated.
- **Consultant context.** The spec says the `safety_consult` parameters include "sufficient context for the consultant to evaluate" the content, but does not define what constitutes sufficient context. This is left to implementation.
