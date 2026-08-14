# Journal: Three-way interaction model

This journal records the development of [three-way-interaction.spec.md](./three-way-interaction.spec.md). It is non-normative; the specification takes precedence.

## Origin

This is the first specification in the repository. It was created in response to a request to formalise the "three-way interaction between the User, the Archive, and the Guide" described in [README.md](../README.md).

The README is descriptive rather than normative, so the specification workflow was initiated to establish normative requirements from it.

## Scope decisions

Through dialogue with the user, the following scope decisions were made:

- **Narrow scope.** This specification governs the roles and interaction protocols of the three actors only. The event system (microbatching, hybrid immediate/probabilistic flush), the constrained agent's turn-budget enforcement, the semantic content system, and content-first retrieval are each left to separate specifications, referenced by intended path.
- **Apparent spontaneity, bounded.** The Guide's autonomy is characterised normatively as requiring apparent spontaneity (via variable timing) while being bounded by a turn budget. The mechanisms for both are deferred to the event system and constrained agent specs respectively; this spec states the observable properties.
- **Interface control with priority and permitted actions.** The spec defines conflict resolution (User precedence) and enumerates the Guide's permitted interface manipulations, rather than leaving these to implementation.
- **Location.** The spec lives at `specs/three-way-interaction.spec.md` as a project-level, cross-cutting concern.

## Dependencies on not-yet-established specifications

This specification links to four specifications that do not yet exist at the time of writing:

- `specs/event-system.spec.md`
- `specs/constrained-agent.spec.md`
- `specs/semantic-content-system.spec.md`
- `specs/content-first-retrieval.spec.md`

The links use the intended repository-relative paths. When those specifications are established, this journal should be updated to confirm the links resolve and that the referenced behaviour is consistent with the requirements stated here.

### Update: content model spec established

The content model has been established as [content-model.spec.md](./content-model.spec.md) (the shorter name was preferred over `semantic-content-system.spec.md`). The references in the three-way interaction spec were updated to point to `./content-model.spec.md`. The `semantic-content-system.spec.md` path is no longer used; the content model spec notes that authoring tooling is deferred to a separate `specs/authoring-tooling.spec.md`.

### Update: constrained agent spec established

The constrained agent has been established as [constrained-agent.spec.md](./constrained-agent.spec.md). It defines the tool-call discipline, permitted tool categories (Navigate, Draw attention, Retrieve) with contracts, interleaved reasoning, and the turn budget with exhaustion behaviour. This resolves the "turn-budget exhaustion behaviour" gap recorded below: the constrained agent spec requires that exhaustion produces a coherent response from accumulated content, with no further reasoning or tool calls.

### Update: event system spec established

The event system has been established as [event-system.spec.md](./event-system.spec.md). It defines high-level semantic events, the event queue, microbatching, the hybrid immediate/probabilistic flush policy, probabilistic interaction triggering, and budget policy (amount, costs, overspend, carryover). This resolves the apparent-spontaneity mechanism: the hybrid flush policy produces the variable timing required by this spec. The three-way interaction spec's references to the event system are confirmed as consistent.

### Update: content-first retrieval spec established

The content-first retrieval spec has been established as [content-first-retrieval.spec.md](./content-first-retrieval.spec.md). It defines the four retrieval modes (by ID, by properties, by text, relationship traversal), result shapes, pagination, and the storage/indexing mechanisms. The three-way interaction spec's reference to content-first retrieval for the Retrieve action is confirmed as consistent: the retrieval interface provides the knowledge base access tools referenced here.

### Update: annotations spec established

The annotations spec has been established as [annotations.spec.md](./annotations.spec.md). It defines the annotation model: annotations are authored as frontmatter on document source files, attach to documents (not content blocks), have a free-form topic and optional affective tone, are compiled alongside documents, are immutable at runtime, and are retrieved as metadata on document retrieval results. This resolves the annotation references in this spec: the Guide's "private, topic-linked notes and recollections represented as annotations on Archive content" are now normatively defined as document-level metadata. The annotations are confirmed as distinct from the Archive's record and from working memory, consistent with this spec's framing of the Guide's subjective perspective.

## Key decisions and rationale

### Guide as constrained actor, not chatbot

The README stresses that the Guide is "an actor with constrained capabilities rather than as a conventional chatbot." The spec makes this normative: the Guide interacts with the Archive exclusively through tool calls and must not manipulate the interface outside the enumerated permitted actions. This is intended to keep the Guide's agency legible and bounded.

### User precedence

The README does not explicitly state conflict resolution rules, but the three-way model implies that the User is the principal agent. The user confirmed User precedence as the desired rule. The spec makes User actions non-preemptive and requires the Guide to yield on conflict, while allowing the Guide to acknowledge interruption. This preserves the Guide's autonomy without letting it override the User.

### Permitted action categories

The permitted actions (Navigate, Draw attention, Retrieve) are drawn directly from the README's description: "draw attention to material, navigate between documents and respond to the User's activity." Retrieval is included because the Guide "interacts with the Archive exclusively through tool calls" and retrieves content. The spec distinguishes retrieval (not visible to the User) from navigation/attention (visible), to avoid implying that every tool call changes the interface.

### Apparent spontaneity as an observable property

Rather than prescribing the flush policy here, the spec states the observable property (variable, non-deterministic timing) and delegates the mechanism to the event system spec. This keeps the interaction model spec focused on roles and protocols while still characterising the Guide's responsiveness normatively. A Gherkin scenario asserts that equivalent user actions must produce varying response timing.

## Gaps and ambiguities

- **"Draw attention" is underspecified.** The README uses the phrase without defining the visual/interaction mechanism. The spec treats it as a category of operation without prescribing presentation. A future specification (or an extension of this one) should define how attention is rendered and whether it is transient or persistent.
- **Guide declining to respond.** The responsiveness scenario permits the Guide to "decline to respond" to activity. The conditions under which the Guide should vs. should not respond are not defined here; they likely belong to the constrained agent spec or a Guide-behaviour spec.
- **Turn budget exhaustion behaviour.** The spec requires the Guide to produce a response within the current turn budget but does not define what happens at the boundary (e.g. graceful truncation). This is deferred to the constrained agent spec.
- **Annotation model.** The Guide's private notes/recollections as "annotations on Archive content" are mentioned but not specified. A semantic content system or annotation spec should define their structure and lifecycle.
