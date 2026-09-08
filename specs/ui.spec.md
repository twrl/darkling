# User interface

## Purpose and scope

This specification defines the Darkling user interface: the presentation of the Archive to the Visitor, the presentation of the Guide, the high-level semantic events the UI produces in response to Visitor activity, the interface operations by which the Visitor and the Guide act upon the Archive interface, and the concrete fields of the shared `interface` state slice that record the presented-interface state.

It governs:

- the scene — the spatial metaphor and visual model within which the Archive and the Guide are presented;
- the reading surface — how documents and content blocks are rendered and navigated, including the table of contents and in-content relationship links;
- the Guide's avatar presentation — the Guide's visible figure and speech, and its placement within the scene;
- attention — how the Guide's Draw-attention operation is rendered transiently on a content block;
- the high-level semantic event vocabulary — the controlled set of event types the UI produces and their payloads, owed to [Constrained agent](./constrained-agent.spec.md#events);
- the Service Worker — the browser Service Worker that manages token handling transparently for backend requests, as defined in [Service Worker](#service-worker);
- the interface operations exposed to both the Visitor and the Guide — Navigate and Draw attention, as defined by [Three-way interaction](./three-way-interaction.spec.md#interface-control), and the UI-control tools that back the Guide's invocation of them;
- the `interface` state slice — its concrete fields, as a refinement of [Runtime](./runtime.spec.md#slice-declarations); the conflict-resolution rules are defined by [Three-way interaction](./three-way-interaction.spec.md#conflict-resolution) and enforced at tool-call dispatch time, as defined in [UI-control tools](#ui-control-tools);
- cap-enforcement presentation — the in-world "rest" surface, as required by [Usage and deployment](./usage-and-deployment.spec.md#cap-enforcement).

It is explicitly out of scope for this specification to define:

- the event queue, the probabilistic flush policy, interaction triggering, and the budget — which are defined by [Constrained agent](./constrained-agent.spec.md);
- the constrained agent's tool-call discipline, the four tool categories, working memory, and FINISHED — which are defined by [Constrained agent](./constrained-agent.spec.md);
- the three-way interaction model — the roles of the User, Archive, and Guide, and the conflict-resolution rules themselves (User precedence, non-preemption, Guide continuity) — which are defined by [Three-way interaction](./three-way-interaction.spec.md). This specification enforces those rules at tool-call dispatch time, as defined in [UI-control tools](#ui-control-tools), not via runtime state invariants;
- the content model — documents, content blocks, relationships, and the compiled content format — which are defined by [Content model](./content-model.spec.md) and [Authoring tooling](./authoring-tooling.spec.md);
- the retrieval interface — which is defined by [Content-first retrieval](./content-first-retrieval.spec.md);
- annotations — which are private to the Guide and must not be rendered by the UI, as defined by [Annotations](./annotations.spec.md);
- the runtime topology — the deployment-level split between frontend and backend, and the external dependencies of a deployed instance — which is defined by [Usage and deployment](./usage-and-deployment.spec.md); the in-frontend worker placement is defined by [Runtime](./runtime.spec.md);
- the runtime's state mechanism — the authority, local copies, state-change propagation, and reactivity — which is defined by [Runtime](./runtime.spec.md). This specification refines the `interface` slice's fields within that mechanism;
- the specific persistent store, LLM provider, and deployment platform — which are defined by [Usage and deployment](./usage-and-deployment.spec.md).

Where this specification depends on behaviour defined by those specifications, it links to them and states its requirement in terms of their observable behaviour, without redefining their mechanisms.

## Design context

Darkling is an immersive, single-Visitor experience: a person explores an interconnected body of fictional material (the Archive) in the company of the Guide. The UI is the surface through which the Visitor reads the Archive, through which the Guide acts upon the Archive interface, and through which the Guide addresses the Visitor. The UI runs on the main thread as Lit components, producing high-level semantic events consumed by the Guide, as defined by [Runtime](./runtime.spec.md#worker-topology).

The UI's central design decision is a spatial metaphor: the Archive is presented as a stack of glassy tablets projected above a surface, and the Guide inhabits the same scene as a visible figure that addresses the Visitor and gestures toward the material. This metaphor serves the three-way interaction model defined by [Three-way interaction](./three-way-interaction.spec.md): the Archive is the shared substrate the Visitor and the Guide both act upon, the Guide draws attention to material by acting on the interface, and the Visitor is the principal agent whose actions take precedence.

The UI is a reactive consumer of the shared `interface` state slice defined by [Runtime](./runtime.spec.md#shared-state). Visitor navigation and the Guide's interface operations are both expressed as mutations to the `interface` slice; the Guide's conflicting actions are rejected at tool-call dispatch time, as defined in [UI-control tools](#ui-control-tools), rather than resolved by the UI ad hoc. The UI renders the current `interface` state reactively.

## Scene

The UI is rendered as a three-dimensional scene. The scene is the spatial container within which the Archive and the Guide are presented.

### Ground plane

A fixed ground plane forms the visual ground of the scene. The tablets are projected above it.

- The ground plane is a visual framing element. It is not itself navigable as document content. It does not host the avatar or the icon rail (those live on the overlay plane, as defined in [Overlay plane](#overlay-plane)).
- The ground plane is fixed: it does not move in response to navigation or interaction.
- The ground plane has no diegetic role beyond framing; it is the surface above which the Archive tablets are projected.

### Overlay plane

An **overlay plane** is a fixed plane above the topmost tablet, hosting the Guide's avatar and the icon rail of minimised non-document tablets. The overlay plane sits above the tablet stack so the avatar and the tools read as instruments/guides above the reading surface, not as content within it.

- The overlay plane is a fixed plane parallel to the ground plane, positioned above the topmost tablet. It does not move with the tablet stack (it is above it, not part of it).
- The overlay plane hosts:
  - the Guide's avatar, at one of its fixed positions, as defined in [Avatar position and visibility](#avatar-position-and-visibility);
  - the icon rail of minimised non-document tablets, as defined in [Non-document tablets](#non-document-tablets).
- The overlay plane is not navigable as document content. The Visitor interacts with the avatar (by dragging) and with the icon rail (by clicking icons to restore tablets), but the overlay plane itself is a framing surface, not an Archive surface.
- Because the avatar and icon rail share the overlay plane, they occupy the same visual layer above the tablets. Their relative placement on the overlay plane (e.g. avatar left, rail right) is an implementation concern; the spec requires that both live on the overlay plane above the topmost tablet.

### Rendering technology

The scene is rendered on the main thread, as defined by [Runtime](./runtime.spec.md#worker-topology). Animation of the avatar and tablet transitions may use `OffscreenCanvas` in a worker, with frames transferred to the main thread via the runtime's Transferable object support, as defined by [Runtime](./runtime.spec.md#transferable-objects); general UI logic remains on the main thread. The specific rendering library is an implementation concern, provided the scene is presented as the spatial model defined here and UI logic runs on the main thread.

```gherkin
Feature: Scene
  Rule: The UI is a 3D scene with a fixed ground plane; tablets above it, an overlay plane above the topmost tablet hosting the Guide and the icon rail

  Scenario: The ground plane is fixed
    Given the scene is rendered
    Then a fixed ground plane must be visible as the visual ground
    And the Visitor must not be able to navigate it as document content
    And the ground plane must not move in response to navigation
    And an overlay plane above the topmost tablet must host the avatar and the icon rail
```

## Non-document tablets

The scene contains tablets that do not present document content: a **table-of-contents tablet** and a **search tablet**. These are navigation surfaces, presented as tablets in the same spatial model as document tablets, and may be minimised to icons on a dedicated icon rail (UI chrome).

- **ToC tablet.** Presents the table of contents (the document-level index: document IDs, slugs, and titles, fetched on bootstrap, as defined by [Content-first retrieval](./content-first-retrieval.spec.md#client-side-caching)). The Visitor selects a document from the ToC tablet to open it: if the document is already in the stack, it is brought to the front; otherwise a new document tablet is pushed onto the front of the stack.
- **Search tablet.** Presents a search interface over the Archive (textual search, as defined by [Content-first retrieval](./content-first-retrieval.spec.md#retrieval-by-textual-content)). The Visitor enters a query and selects a result to open the target document/block: if the target document is already in the stack, it is brought to the front and the target block is focused; otherwise a new tablet is pushed and the target block is focused.
- **Minimising.** Either non-document tablet may be minimised to an icon on the icon rail, which lives on the overlay plane above the topmost tablet, as defined in [Overlay plane](#overlay-plane). Clicking/tapping a minimised icon restores the tablet. Minimising and restoring are UI affordances on the non-document tablets, not state changes to the `interface` slice (the `interface` slice tracks document tablets, not the ToC/search tablet or their minimised state).
- **Relationship to document tablets.** Non-document tablets are not part of the document stack and are not subject to the front-most-active/behind-recede ordering of document tablets. They are independent surfaces the Visitor opens, minimises, and restores as navigation aids. Whether a non-document tablet visually occludes or sits alongside the document stack when open is an implementation concern; the spec requires that the ToC and search are presented as tablets (not as always-visible chrome) and may be minimised to icons on the icon rail.

## Reading surface

The Archive is presented as a stack of tablets. Each tablet presents one document; the document's content blocks are rendered within its tablet.

### Tablets

A **tablet** is a glassy panel in the 3D scene, projected above the ground plane. Tablets present either a single document (document tablets, the reading surface) or a navigation surface (non-document tablets: the ToC and search, as defined in [Non-document tablets](#non-document-tablets)).

- One document tablet corresponds to one document. A document tablet renders that document's content as continuous Markdown, as defined by [Authoring tooling](./authoring-tooling.spec.md#compiled-content-format).
- A document's content blocks are rendered within its tablet, in document order, as the continuous Markdown body of the document. Blocks are the structural units by which the Guide and the retrieval interface address content, as defined by [Content model](./content-model.spec.md); within the tablet they are not visually boxed as discrete cards but rendered as the document's continuous text.
- A block within a document tablet may be *focused* — scrolled into comfortable reading position and visually emphasised within the continuous render — by the Navigate-to-block and Draw-attention operations, as defined in [Focus](#focus) and [Attention](#attention).
- Non-document tablets (ToC, search) present navigation surfaces and may be minimised to icons on an icon rail (UI chrome), as defined in [Non-document tablets](#non-document-tablets). The stack and active-document model below apply to document tablets; non-document tablets are not part of the document stack.

### The stack

Open documents are presented as a stack of tablets in the 3D scene.

- The **front-most tablet** is the active document. It is fully readable and is the document upon which the Guide's interface operations act.
- Tablets behind the front-most tablet are **open but inactive**. They are visible — receding into depth, tilted and defocused — and serve as a navigation affordance showing what is open behind the active document. They are not fully readable while behind the front-most tablet.
- Bringing a tablet to the front makes it the active document and renders it fully readable; the previously active tablet recedes behind it.
- The stack is ordered: each tablet has a position in the stack. Navigation may push a new tablet onto the front of the stack, bring an existing tablet to the front (re-ordering the stack), or close a tablet (removing it from the stack), as defined in [Visitor navigation](#visitor-navigation) and [Guide interface operations](#guide-interface-operations).

There is at most one active document. The active document is the front-most tablet, as defined in [The `interface` slice](#the-interface-slice).

### Focus

A block within the active document's tablet may be **focused**.

- Focusing a block scrolls it into comfortable reading position within the tablet's continuous render and applies a brief visual emphasis to the block.
- Focus is transient for the Draw-attention operation: the emphasis fades after a short time or on the next Visitor action, as defined in [Attention](#attention).
- Focus is the mechanism by which Navigate-to-block locates the Visitor/Guide within a document: navigating to a block focuses it within the document's tablet. Focus established by navigation persists until the next navigation or attention action (it is not a timed fade); this is the block the interface currently presents within the document.

### Visitor navigation

The Visitor navigates the Archive by opening, bringing forward, and closing documents, and by traversing relationships.

- **Table of contents.** The ToC tablet lists the documents of the Archive by title, as fetched on bootstrap, as defined in [Non-document tablets](#non-document-tablets) and [Content-first retrieval](./content-first-retrieval.spec.md#client-side-caching). The Visitor selects a document from the ToC tablet to open it: if the document is already in the stack, it is brought to the front; otherwise a new tablet is pushed onto the front of the stack.
- **In-content relationship links.** Relationships between content blocks are rendered as navigable links within the document's content, as defined by [Content model](./content-model.spec.md#relationships). The Visitor follows a relationship link to open the target: if the target document is already in the stack, it is brought to the front and the target block is focused; otherwise a new tablet is pushed and the target block is focused.
- **Closing a tablet.** The Visitor may close a tablet, removing its document from the stack. Closing the active tablet makes the next tablet behind it the active document. Closing the last tablet leaves the stack empty; the scene presents the ground plane and the Guide with no active document.
- **Scroll within a document.** The Visitor may scroll within the active tablet's continuous render. Scrolling changes the blocks in view but does not change the active document or push a tablet.

Visitor navigation produces high-level semantic events, as defined in [Events](#events), and proposes updates to the `interface` slice, as defined in [The `interface` slice](#the-interface-slice).

```gherkin
Feature: Reading surface
  Rule: Documents are glassy tablets in a stack; the front-most is active and fully readable

  Scenario: Opening a new document pushes a tablet
    Given the stack has one active tablet presenting document A
    When the Visitor opens document B from the ToC
    Then a new tablet presenting document B must be pushed to the front
    And document B must become the active document
    And document A must recede behind it

  Scenario: Opening an already-open document brings it forward
    Given the stack has tablets for document A (front) and document B (behind)
    When the Visitor selects document B from the ToC
    Then document B's tablet must be brought to the front
    And document B must become the active document
    And document A must recede behind it

  Scenario: Following a relationship link focuses the target block
    Given the stack's active tablet presents document A
    When the Visitor follows a relationship link to a block in document C
    Then document C's tablet must be pushed to the front (or brought forward if already open)
    And the target block must be focused within document C's tablet

  Scenario: Closing the active tablet
    Given the stack has tablets for document A (front) and document B (behind)
    When the Visitor closes document A's tablet
    Then document A must be removed from the stack
    And document B must become the active document

  Scenario: Closing the last tablet
    Given the stack has only document A's tablet
    When the Visitor closes document A's tablet
    Then the stack must be empty
    And the scene must present the ground plane and the Guide with no active document
```

## The Guide's avatar

The Guide is presented as a visible figure within the scene, accompanied by speech.

### Figure

The Guide's avatar is a rendered figure inhabiting the 3D scene above the ground plane.

- The avatar is *detached* from the tablets: it floats above or beside the surface, able to gesture and look toward the tablets, but is not spatially anchored to a specific tablet. The avatar does not occupy a tablet.
- The avatar may gesture toward the active tablet when drawing attention or navigating, as a visible cue reinforcing the Guide's action, but its position is not fixed to a particular tablet.
- The avatar's animation may be rendered via `OffscreenCanvas` in a worker, as defined in [Rendering technology](#rendering-technology).

#### Avatar position and visibility

The Guide may reposition its avatar among a small set of fixed positions and may show or hide it. The Visitor may also reposition the avatar by dragging. The avatar's position and visibility are part of the avatar's own presentation.

- **Fixed positions.** The avatar occupies one of a small, named set of fixed positions on the overlay plane (e.g. "left", "center", "right", "aside"), as defined in [Overlay plane](#overlay-plane). The set is a UI/policy parameter: this specification requires that the set exists, is small, and is named; the concrete positions (their coordinates on the overlay plane) are configuration. The avatar is always at one of these positions when visible (it does not float at arbitrary points in the scene).
- **Guide repositioning.** The Guide repositions its avatar by choosing a position from the fixed set, via the `set_avatar_position` tool, as defined in [Avatar-interaction tools](#avatar-interaction-tools). The parameter is the position's name, not a free coordinate.
- **Visitor dragging.** The Visitor may drag the avatar to reposition it. On release, the avatar **snaps to the nearest fixed position** from the set. The drag-and-snap is a Visitor action: it produces an `avatar_repositioned` event with the snapped position, as defined in [Events](#events). Dragging does not propose an `interface` slice update (the avatar position is not Archive interface state).
- **Visibility.** The avatar has a **visibility** state: visible or hidden. When hidden, the avatar is not rendered in the scene; the Guide is absent from the Visitor's view until it shows itself again. The Guide may hide its avatar (e.g. to step out of a scene) and show it again (e.g. to re-enter), via the `set_avatar_visibility` tool. The Visitor does not control visibility (only the Guide hides/shows its avatar).
- Repositioning and showing/hiding are immediate transitions by default; the Guide may animate them by issuing an animation tool call, as defined in [Avatar animation](#avatar-animation).
- The avatar's position and visibility are part of the avatar's own presentation, not the Archive interface. They do not interact with the `interface` slice, as defined by [Constrained agent](./constrained-agent.spec.md#tool-categories) (avatar interaction tools must not alter the Archive, the UI's navigation or attention state, or any persistent state other than the avatar's own presentation).

The Guide's speech is rendered near the avatar's current position; when the avatar is hidden, the Guide must not produce speech (a hidden Guide is absent and cannot address the Visitor). The UI must reject a speech tool call while the avatar is hidden, as defined in [Avatar-interaction tools](#avatar-interaction-tools).

### Speech

The Guide addresses the Visitor through speech, rendered in-scene near the avatar.

- The Guide's communication with the Visitor is produced exclusively through avatar interaction tools, as defined by [Constrained agent](./constrained-agent.spec.md#tool-categories); free text is not permitted as model output. The UI renders the speech produced by those tools.
- Speech is rendered as text associated with the avatar (e.g. a speech region near the figure). The specific visual treatment is an implementation concern.
- The Guide's speech is the only channel by which the Guide addresses the Visitor directly, as defined by [Three-way interaction](./three-way-interaction.spec.md#guide-user). The UI must not present Guide-authored content to the Visitor through any channel other than the avatar's speech and the visible effects of UI-control operations.

### Visibility of Guide actions

The Guide's actions are visible to the Visitor only through:

- the avatar's speech, produced by avatar interaction tools;
- visible changes to the presented interface produced by UI-control operations (Navigate, Draw attention), as defined by [Constrained agent](./constrained-agent.spec.md#visibility).

The Guide's avatar presentation — position, visibility, and animation — is also visible to the Visitor, produced by avatar interaction tools, as defined in [Avatar-interaction tools](#avatar-interaction-tools). These affect the avatar's own presentation, not the Archive interface, and are not subject to the three-way interface conflict-resolution rules.

Retrieval, agent-self, and safety operations are not visible, as defined by [Constrained agent](./constrained-agent.spec.md#visibility). Annotations are not rendered by the UI, as defined by [Annotations](./annotations.spec.md#guide-access).

```gherkin
Feature: Guide avatar
  Rule: The Guide is a visible figure in the scene with speech; its actions are visible through speech, avatar presentation, and UI-control effects

  Scenario: The Guide addresses the Visitor through speech
    Given the Guide produces speech via an avatar interaction tool
    And the avatar is visible
    When the UI renders it
    Then the speech must appear as text associated with the avatar in the scene

  Scenario: The Guide gestures toward the active tablet when drawing attention
    Given the Guide issues a Draw-attention operation on a block in the active document
    When the UI renders it
    Then the avatar may gesture toward the active tablet
    And the block must be highlighted within the tablet, as defined in Attention

  Scenario: The Guide hides its avatar
    Given the Guide is visible in the scene
    When the Guide issues a set_avatar_visibility tool call to hide
    Then the avatar must no longer be rendered
    And the Guide is absent from the Visitor's view

  Scenario: A hidden Guide cannot speak
    Given the Guide has hidden its avatar
    When the Guide issues a speech tool call
    Then the tool call must be rejected
    Because a hidden Guide is absent and cannot address the Visitor

  Scenario: The Guide repositions its avatar to a named fixed position
    Given the avatar is visible at position "center"
    When the Guide calls set_avatar_position({ position: "left" })
    Then the avatar must move to the "left" fixed position
    And no interface slice update must be proposed

  Scenario: The Visitor drags the avatar and it snaps, producing an event
    Given the avatar is visible at position "center"
    When the Visitor drags the avatar and releases near the "left" position
    Then the avatar must snap to the "left" fixed position
    And an avatar_repositioned event must be produced with payload { position: "left" }
    And no interface slice update must be proposed
```

### Avatar animation

The Guide may animate its avatar: driving motion, gesture, or transition over time, rather than as an immediate change.

- An animation tool call drives the avatar's motion or gesture over a duration. The specific animation vocabulary (named gestures, poses, motion clips) is an implementation concern; this specification requires that the Guide may issue an animation and that the UI renders it over time on the avatar.
- An animation may accompany a reposition or show/hide, animating the transition rather than snapping it (e.g. the Guide walks to a new position, or fades in/out).
- Animations are part of the avatar's own presentation, not the Archive interface. They do not interact with the `interface` slice.
- An animation may be interrupted by a subsequent avatar-interaction tool call (e.g. a new position, a new gesture); the UI is not required to queue or complete a running animation before applying a new one. The specific interruption behaviour (blend, cut, cancel) is an implementation concern.

## Attention

The Guide's Draw-attention operation renders as a transient highlight on a content block within the active document's tablet.

- Drawing attention to a block focuses it — scrolls it into comfortable reading position within the tablet — and applies a visual highlight (e.g. an edge glow or soft light) to the block.
- The highlight is transient: it fades after a short time, or on the next Visitor action, whichever comes first. Attention establishes no persistent state in the `interface` slice.
- The avatar may gesture toward the highlighted block as a visible cue, as defined in [Figure](#figure).
- The Guide may draw attention only to a block within the active document (the front-most tablet). Drawing attention to a block in an inactive document is not a permitted Draw-attention operation; the Guide must first navigate to the document.

Because attention is transient and establishes no persistent state, the `interface` slice records the *focus* produced by navigation (the block the interface currently presents within the document) but does not record a separate "attention" field. Draw-attention is delivered as a transient UI effect driven by the Guide's tool call, not as a state change to the `interface` slice.

```gherkin
Feature: Attention
  Rule: Draw-attention is a transient highlight that focuses a block and fades

  Scenario: Drawing attention highlights and focuses a block, then fades
    Given the active document is document A, presenting its tablet
    And the Guide issues a Draw-attention operation on block B within document A
    When the UI renders it
    Then block B must be scrolled into comfortable reading position within the tablet
    And block B must be highlighted
    And the highlight must fade after a short time or on the next Visitor action
    And no persistent attention state must remain in the interface slice

  Scenario: The Guide may not draw attention to an inactive document
    Given document A is active and document B is open but inactive (behind A)
    When the Guide issues a Draw-attention operation on a block in document B
    Then the operation must not succeed as a Draw-attention
    And the Guide must first navigate to document B
```

## Events

The UI produces high-level semantic events in response to Visitor activity, as required by [Constrained agent](./constrained-agent.spec.md#events). This section establishes the controlled vocabulary of event types and their payloads, owed to [Constrained agent](./constrained-agent.spec.md#events).

Every event carries a `type`, a `timestamp`, and a `payload`, and is immutable once produced, as defined by [Constrained agent](./constrained-agent.spec.md#event-structure). The event types and their payloads are defined below. The trigger probability for each event type is a policy parameter owned by [Constrained agent](./constrained-agent.spec.md#policy-parameters); this specification defines the event *types*, not their trigger probabilities.

### Event types

The UI must produce the following high-level semantic event types:

| Type | Produced when | Payload |
| --- | --- | --- |
| `document_opened` | The Visitor opens a document (from the ToC, by relationship traversal, or by any navigation that pushes or brings forward a tablet). | `{ document: DocumentId, block?: BlockId }` — the document opened, and the block focused if navigation targeted a specific block. |
| `document_closed` | The Visitor closes a tablet, removing a document from the stack. | `{ document: DocumentId }` — the document closed. |
| `attention_drawn` | The Visitor draws their own attention to a block within the active document (e.g. by dwelling on, expanding, or otherwise visibly engaging a block). | `{ document: DocumentId, block: BlockId }` — the document and the block attended to. |
| `relationship_traversed` | The Visitor follows an in-content relationship link from one block to a target. | `{ source: BlockId, relationship: string, target: BlockId }` — the source block, the relationship type, and the target block. |
| `direct_address` | The Visitor directly addresses the Guide (via the address input, defined in [Addressing the Guide](#addressing-the-guide)). | `{ text: string }` — the address text. |
| `scroll` | The Visitor scrolls within the active document's tablet, changing the blocks in view. | `{ document: DocumentId, blocks: BlockId[] }` — the document and the block IDs brought into view by the scroll. |
| `avatar_repositioned` | The Visitor drags the avatar and releases; the avatar snaps to the nearest fixed position, as defined in [Avatar position and visibility](#avatar-position-and-visibility). | `{ position: PositionId }` — the snapped fixed position. |
| `session_start` | The Visitor arrives at the Archive: the frontend has completed bootstrap and is ready. Emitted exactly once per page load, before the UI produces any other event, as defined in [Session start](#session-start). | `{ }` — empty payload. |

`DocumentId` and `BlockId` are the branded string identifiers defined by [Content model](./content-model.spec.md). `PositionId` is a name from the fixed avatar position set, as defined in [Avatar position and visibility](#avatar-position-and-visibility).

### Session start

The `session_start` event marks the Visitor's arrival at the Archive. It is produced by the frontend once, when bootstrap is complete and the frontend is ready, before the UI produces any Visitor-activity event. It is a Visitor-initiated event — the Visitor arriving is activity — not a system event.

- `session_start` is emitted exactly once per page load. A page reload begins a new session and emits `session_start` again, since the Guide worker is freshly started each load.
- `session_start` is emitted before the UI accepts Visitor input that produces other events, so it is the sole event in the queue when its flush triggers the Guide's first interaction.
- `session_start` has a trigger probability of 1.0, as defined in [Constrained agent](./constrained-agent.spec.md#trigger-probability): the Guide is always triggered once at session start.
- The payload is empty. Session context the Guide may need is available through other channels: the status object carries working memory and budget, as defined by [Constrained agent](./constrained-agent.spec.md#interaction-input), and the Guide may retrieve the Archive's contents through the retrieval tools, as defined by [Content-first retrieval](./content-first-retrieval.spec.md).

### Event sources and non-events

Events are produced by the UI in response to Visitor activity, as defined by [Constrained agent](./constrained-agent.spec.md#event-sources). The Guide does not produce events; the Guide consumes them. Guide-initiated actions (tool calls) produce their effects through the [Constrained agent](./constrained-agent.spec.md) and the UI-control operations defined here, not through the event system.

The UI must not produce events for:

- Guide actions (navigation, attention, speech) — these are not Visitor activity;
- internal UI state changes that do not reflect Visitor activity (e.g. a tablet transition animation completing, a cache update);
- raw input events (clicks, keystrokes) — the UI produces high-level semantic events, not raw input, as defined by [Constrained agent](./constrained-agent.spec.md#events).

### `attention_drawn` vs Guide Draw-attention

`attention_drawn` (the event) is produced when the *Visitor* draws their own attention to a block. It is distinct from the Guide's Draw-attention *operation*, which is a UI-control tool call that renders a transient highlight, as defined in [Attention](#attention). The Guide's Draw-attention does not produce an `attention_drawn` event.

```gherkin
Feature: Events
  Rule: The UI produces high-level semantic events for Visitor activity; Guide actions do not produce events

  Scenario: Opening a document from the ToC produces document_opened
    Given the Visitor selects document A from the ToC
    When the document is opened
    Then a document_opened event must be produced with payload { document: A }

  Scenario: Following a relationship link produces relationship_traversed
    Given the Visitor follows a link from block X (relationship "references") to block Y
    When the link is followed
    Then a relationship_traversed event must be produced with payload { source: X, relationship: "references", target: Y }
    And a document_opened event must be produced for the target's document if it was not already active

  Scenario: A Guide navigation does not produce an event
    Given the Guide issues a Navigate operation to document B
    When the UI applies it
    Then no document_opened event must be produced
    Because the Guide does not produce events

  Scenario: An internal animation does not produce an event
    Given a tablet transition animation completes
    When the animation ends
    Then no event must be produced
    Because internal UI state changes are not Visitor activity

  Scenario: The Visitor dragging the avatar produces avatar_repositioned
    Given the Visitor drags the avatar and releases near a fixed position
    When the avatar snaps to that position
    Then an avatar_repositioned event must be produced with the snapped position
    Because Visitor dragging is Visitor activity

  Scenario: A Guide repositioning its avatar does not produce an event
    Given the Guide calls set_avatar_position
    When the UI applies it
    Then no avatar_repositioned event must be produced
    Because Guide actions do not produce events

  Scenario: The Visitor's arrival produces session_start and triggers the Guide
    Given the frontend has completed bootstrap and is ready
    When the UI emits session_start
    Then a session_start event must be produced with an empty payload
    And it must be the sole event in the queue
    And the queue must be flushed, triggering the Guide's first interaction
    Because the Visitor arriving at the Archive is Visitor activity
```

## Service Worker

A Service Worker runs in the browser, intercepting fetch requests from the frontend. Its responsibility is transparent token handling: it attaches `Authorization: Bearer <token>` headers to requests destined for the backend (LLM proxy and retrieval) and manages the token lifecycle, so that the frontend's application code is unaware of tokens.

### Token lifecycle

The Service Worker manages the token lifecycle, as defined by the access model in [Usage and deployment](./usage-and-deployment.spec.md#access-and-authentication):

- **Activation.** On activation, the Service Worker obtains a token: it exchanges a presented pre-shared secret for a signed token, or requests an anonymous token if no secret is presented. The token carries the Visitor's access-tier claim.
- **Attachment.** The Service Worker intercepts fetch requests destined for the backend and attaches `Authorization: Bearer <token>` before forwarding them. Requests to other origins are passed through unmodified.
- **Refresh and expiry.** The Service Worker handles token refresh and expiry, re-exchanging or refreshing as needed, so that backend requests continue to carry a valid token without application-code involvement.
- **Token isolation.** The token is not visible to the page and is not carried in a cookie. Application code makes ordinary `fetch` calls; the Service Worker intercepts, attaches, and manages the token transparently.

The application code is unaware of tokens and unaware of the tier, except that the UI displays in-world messaging when a cap is reached, as defined in [Cap enforcement](#cap-enforcement). The backend validates the token on each request and applies the tier's caps and limits, as defined by [Usage and deployment](./usage-and-deployment.spec.md#cost-and-abuse-controls).

### Bootstrap ordering

The Service Worker activates and obtains a token before the runtime starts, so that backend requests during bootstrap (e.g. the table-of-contents fetch) carry valid credentials. This is the first step of the bootstrap sequence, as defined by [Runtime](./runtime.spec.md#bootstrap).

```gherkin
Feature: Service Worker
  Rule: The Service Worker manages tokens transparently; application code is unaware of tokens

  Scenario: Service Worker attaches the token transparently
    Given the Service Worker holds a valid token
    When the frontend makes a fetch request to the backend
    Then the Service Worker must attach the Authorization header
    And the application code must not handle the token

  Scenario: Service Worker obtains a token on activation
    Given the frontend page has loaded
    When the Service Worker activates
    Then it must obtain a token (exchanging a presented secret or requesting an anonymous token)
    And this must occur before backend requests are made during bootstrap

  Scenario: Token is not visible to the page
    Given the Service Worker holds a token
    Then the token must not be visible to the page
    And the token must not be carried in a cookie

  Scenario: Non-backend requests pass through
    Given the frontend makes a fetch request to an origin other than the backend
    When the Service Worker intercepts it
    Then it must pass the request through unmodified
```

## Addressing the Guide

The Visitor may directly address the Guide. A direct address is the mechanism by which the Visitor asks the Guide a question or responds to the Guide.

- The UI provides an address input by which the Visitor composes and submits a direct address to the Guide.
- Submitting a direct address produces a `direct_address` event with the address text as its payload, as defined in [Events](#events). A `direct_address` event has a trigger probability of 1.0, as defined by [Constrained agent](./constrained-agent.spec.md#trigger-probability): a direct address always flushes the event queue and triggers an interaction.
- The address input is part of the UI chrome, not part of the tablets. Its specific placement and visual treatment is an implementation concern.

The address input is the sole channel for direct Visitor-to-Guide communication. The Guide responds through its avatar's speech, as defined in [Speech](#speech).

## Interface operations

The Archive interface exposes a set of operations that may be invoked by both the Visitor and the Guide, as defined by [Three-way interaction](./three-way-interaction.spec.md#interface-control). This section defines the operations and the tools by which the Guide invokes them.

### Navigate

The Navigate operation moves the interface to present a specific document or content block, as defined by [Three-way interaction](./three-way-interaction.spec.md#permitted-guide-actions).

- **Visitor navigation** is performed directly by the Visitor (ToC selection, relationship links, closing tablets), as defined in [Visitor navigation](#visitor-navigation). Visitor navigation proposes updates to the `interface` slice, setting `openedBy: "ui"` on any tablet it pushes.
- **Guide navigation** is performed by the Guide through a UI-control tool call, as defined in [UI-control tools](#ui-control-tools). The `navigate` tool's dispatch enforces User precedence by inspecting the current stack (each tablet's `openedBy`), as defined in [UI-control tools](#ui-control-tools); a Guide navigation that survives dispatch is then proposed as an `interface` slice update, setting `openedBy: "guide"` on any tablet it pushes.

Navigating to a document pushes or brings forward its tablet; navigating to a block within a document focuses the block within that document's tablet, as defined in [Focus](#focus).

### Draw attention

The Draw-attention operation emphasises a block within the active document to direct the Visitor's attention, as defined by [Three-way interaction](./three-way-interaction.spec.md#permitted-guide-actions).

- Draw-attention is a transient UI effect, not a state change to the `interface` slice, as defined in [Attention](#attention).
- The Guide invokes Draw-attention through a UI-control tool call, as defined in [UI-control tools](#ui-control-tools).
- The Visitor does not invoke a "Draw-attention operation"; the Visitor's own attention is observed as the `attention_drawn` event, as defined in [Events](#events).

### Retrieve

The Retrieve operation retrieves content blocks by ID, by properties, or by textual search, and traverses relationships, as defined by [Content-first retrieval](./content-first-retrieval.spec.md). Retrieval is performed by the Guide through knowledge-base-access tools and is not visible to the Visitor, as defined by [Constrained agent](./constrained-agent.spec.md#visibility). The UI does not expose a Retrieve operation to the Visitor; the Visitor navigates via the ToC and relationship links.

### UI-control tools

The Guide's Navigate and Draw-attention operations are invoked through UI-control tools, registered on the runtime as defined by [Runtime](./runtime.spec.md) and dispatched by the constrained agent, as defined by [Constrained agent](./constrained-agent.spec.md#tool-categories). This specification defines the tools that back the Guide's interface operations.

The UI-control category must include at least the following tools:

| Tool | Parameters | Effect | Visible |
| --- | --- | --- | --- |
| `navigate` | `{ document: DocumentId, block?: BlockId }` | Propose a Navigate operation: push/bring forward the document's tablet and focus the block if given. **Dispatch enforces User precedence:** the dispatch inspects the current `interface` stack — if the active document's tablet has `openedBy: "ui"` and the call would change `activeDocument` away from it, the call is rejected with an error indicating the Visitor opened that document; the Guide must yield. A call that targets the current `ui`-opened active document (e.g. focusing a block within it) is accepted. Surviving calls propose an `interface` slice update, setting `openedBy: "guide"` on any tablet they push. | Yes |
| `draw_attention` | `{ document: DocumentId, block: BlockId }` | Render a transient Draw-attention highlight on the block within the document's tablet, as defined in [Attention](#attention). The document must be the active document; otherwise the tool call fails and the Guide must first navigate. | Yes (transient) |

These tools must conform to the UI-control category constraints defined by [Constrained agent](./constrained-agent.spec.md#tool-categories): they produce visible interface changes and are subject to the User precedence rules. The `navigate` tool enforces User precedence at dispatch time by inspecting the current `interface` stack (each tablet's `openedBy`), as defined in the tool's row above. A `navigate` call that conflicts with a Visitor-established active document is rejected before any `interface` slice mutation is committed; the Guide must yield, as defined by [Three-way interaction](./three-way-interaction.spec.md#conflict-resolution). The Guide may acknowledge the interruption in its response (Guide continuity), but must not reassert the preempted navigation.

The `draw_attention` tool does not propose an `interface` slice update (attention is transient); it dispatches the transient highlight directly via the UI-control service. A `draw_attention` call targeting a block in an inactive document must fail with an error indicating the document is not active; the Guide must navigate to the document first.

### Avatar-interaction tools

The Guide controls its avatar's presentation — position, visibility, animation, and speech — through avatar interaction tools, registered on the runtime and dispatched by the constrained agent, as defined by [Constrained agent](./constrained-agent.spec.md#tool-categories). This specification defines the avatar interaction tools that back the Guide's avatar control.

The avatar-interaction category must include at least the following tools:

| Tool | Parameters | Effect | Visible |
| --- | --- | --- | --- |
| `speak` | `{ text: string }` | Render the text as speech near the avatar. Must be rejected if the avatar is hidden, as defined in [Avatar position and visibility](#avatar-position-and-visibility). | Yes |
| `set_avatar_position` | `{ position: PositionId }` | Reposition the avatar to the named fixed position. `PositionId` is a name from the fixed position set, as defined in [Avatar position and visibility](#avatar-position-and-visibility). Immediate unless an animation accompanies it. | Yes |
| `set_avatar_visibility` | `{ visible: boolean }` | Show (`true`) or hide (`false`) the avatar. Hiding makes the Guide absent from the scene; a hidden Guide cannot speak, as defined in [Avatar position and visibility](#avatar-position-and-visibility). | Yes |
| `animate_avatar` | `{ animation: string, params?: object }` | Drive an animation on the avatar (motion, gesture, or transition) over a duration. `animation` names an animation from the implementation's vocabulary; `params` are animation-specific. May accompany a reposition or show/hide to animate the transition. | Yes |

These tools must conform to the avatar-interaction category constraints defined by [Constrained agent](./constrained-agent.spec.md#tool-categories): they affect the avatar's own presentation only, and must not alter the Archive, the UI's navigation or attention state, or any persistent state other than the avatar's own presentation. They are not subject to the three-way interface conflict-resolution rules (they do not act on the Archive interface).

The avatar's position and visibility are not part of the `interface` slice (the Archive interface state). Whether they are held as separate avatar state is an implementation concern; the spec requires only that the Guide may control them and that a hidden avatar cannot speak.

```gherkin
Feature: Avatar-interaction tools
  Rule: The Guide controls its avatar's position, visibility, animation, and speech via bus tools; these affect the avatar only, not the Archive interface

  Scenario: The Guide repositions its avatar
    Given the avatar is visible at position P1
    When the Guide calls set_avatar_position({ position: P2 })
    Then the avatar must move to position P2
    And no interface slice update must be proposed

  Scenario: The Guide animates its avatar
    Given the avatar is visible
    When the Guide calls animate_avatar({ animation: "gesture_wave" })
    Then the avatar must perform the gesture_wave animation over a duration
    And no interface slice update must be proposed

  Scenario: The Guide hides then shows its avatar
    Given the avatar is visible
    When the Guide calls set_avatar_visibility({ visible: false })
    Then the avatar must no longer be rendered
    When the Guide later calls set_avatar_visibility({ visible: true })
    Then the avatar must be rendered again

  Scenario: A hidden Guide cannot speak
    Given the avatar is hidden
    When the Guide calls speak({ text: "..." })
    Then the tool call must be rejected
    And no speech must be rendered

  Scenario: An avatar tool does not affect the Archive interface
    Given the Guide calls set_avatar_position or animate_avatar or set_avatar_visibility
    When the UI applies it
    Then the interface slice must not change
    Because avatar tools affect the avatar's own presentation, not the Archive interface
```

```gherkin
Feature: UI-control tools
  Rule: The Guide's Navigate and Draw-attention are bus tools; Navigate proposes an interface update, Draw-attention is transient

  Scenario: The Guide navigates to a document
    Given the active document is A (opened by the Guide)
    When the Guide calls navigate({ document: B })
    Then the call must survive dispatch (A was not opened by the Visitor)
    And a guide-sourced interface update proposing B as active must be submitted
    And B's tablet must be brought forward and B must become active

  Scenario: A conflicting Guide navigation yields at dispatch time
    Given the active document is A (opened by the Visitor: openedBy "ui")
    When the Guide calls navigate({ document: B })
    Then the call must be rejected at dispatch time, before any interface update is proposed
    And the error must indicate that the Visitor opened document A
    And the Guide's navigation must yield
    And document A must remain active

  Scenario: A Guide navigation to the Visitor's active document is accepted
    Given the active document is A (opened by the Visitor: openedBy "ui")
    When the Guide calls navigate({ document: A, block: X })
    Then the call must survive dispatch (it does not change activeDocument away from A)
    And a guide-sourced interface update focusing block X within A must be submitted

  Scenario: Draw-attention on an inactive document fails
    Given document A is active and document B is open but inactive
    When the Guide calls draw_attention({ document: B, block: X })
    Then the tool call must fail
    And the error must indicate that document B is not active

  Scenario: Draw-attention does not change interface state
    Given the Guide calls draw_attention({ document: A, block: X })
    When the highlight is rendered
    Then no interface slice update must be proposed for the attention
    And the highlight must fade, leaving no attention state
```

## The `interface` slice

The `interface` state slice records the presented-interface state. This section is the refinement of [Runtime](./runtime.spec.md#slice-declarations) that establishes the concrete fields of the `interface` slice.

### Fields

The `interface` slice's value is an object with the following fields:

| Field | Type | Description |
| --- | --- | --- |
| `stack` | `Array<{ document: DocumentId, openedBy: 'ui' | 'guide' | 'service' }>` | The open documents, ordered from front (active) to back. The first element is the active document. `openedBy` records how each tablet was opened (`ui`, `guide`, or `service`), used to enforce User precedence at tool-call dispatch time, as defined in [UI-control tools](#ui-control-tools). Empty when no document is open. |
| `activeDocument` | `DocumentId \| null` | The front-most document — the active document. `null` when the stack is empty. Must equal `stack[0]?.document` when the stack is non-empty. |
| `focus` | `{ document: DocumentId, block: BlockId } \| null` | The block currently focused within the active document, established by navigation. `null` when no block is focused or no document is active. Must reference a block within the active document when non-null. |

```ts
// Zod v4
const interfaceSliceSchema = z.object({
  stack: z.array(z.object({ document: z.string(), openedBy: z.enum(['ui', 'guide', 'service']) })),
  activeDocument: z.string().nullable(),
  focus: z.object({ document: z.string(), block: z.string() }).nullable(),
});
```

The slice does **not** carry attention state (attention is transient, as defined in [Attention](#attention)) or speech state (speech is delivered by avatar-interaction tools and rendered as it is produced, not held in shared state).

The `openedBy` field records how each tablet was opened (`ui`, `guide`, or `service`). A tablet's `openedBy` is set when it is pushed onto the stack and does not change while the tablet remains in the stack; bringing an existing tablet to the front does not change its `openedBy`.

The `interface` slice does **not** declare invariant functions. Internal consistency (`activeDocument` equals `stack[0]?.document`, `focus` within `activeDocument`) is maintained by the mutations themselves, which are the only mechanism for changing the slice's value, as defined by [Runtime](./runtime.spec.md#mutation-processing). User precedence is enforced at tool-call dispatch time, not at the runtime state authority: the `navigate` tool's dispatch inspects the current stack (with each tablet's `openedBy`) and rejects a Guide navigation that would override a `ui`-opened active document, as defined in [UI-control tools](#ui-control-tools).

## Cap enforcement

When the Visitor's per-session spend cap is reached, the Guide must stop incurring LLM cost, and the UI must present the cap in-world, as required by [Usage and deployment](./usage-and-deployment.spec.md#cap-enforcement).

- The UI must present an in-world "rest" message — the Guide indicates, through its avatar's speech, that it needs to rest or is otherwise unavailable — rather than a system error or a fourth-wall-breaking limit notification.
- The "rest" message is delivered through the Guide's avatar speech, consistent with [Speech](#speech): the Guide communicates with the Visitor exclusively through the avatar.
- The UI must not reveal the cap as a system/technical limit (no "you have exceeded your budget" UI). The cap is diegetic, as defined by [Usage and deployment](./usage-and-deployment.spec.md#cap-enforcement).
- After the rest message, the Guide must not dispatch further tool calls or produce speech; the interaction ends as if the Guide returned FINISHED, as defined by [Usage and deployment](./usage-and-deployment.spec.md#cap-enforcement).

The specific rest message text and the conditions under which the backend signals the cap (refusing further LLM calls) are defined by [Usage and deployment](./usage-and-deployment.spec.md#cap-enforcement); this specification defines only the UI's presentation of it.

## Reactivity and shared state

The UI is a reactive consumer of the `interface` state slice, as defined by [Runtime](./runtime.spec.md#local-copies).

- The UI (main thread) holds a `LocalCopy` of the `interface` slice, provided by a `<runtime-host>` element, as defined by the `@darkling/runtime` package's Lit integration.
- The UI renders the current `interface` state (stack, activeDocument, focus) reactively, using TC39 signals via the `@lit-labs/signals` integration, so that accepted updates from any source (Visitor or Guide) re-render the reading surface.
- Visitor navigation and the Guide's `navigate` tool both commit mutations to the `interface` slice via the store interface, as defined by [Runtime](./runtime.spec.md#store-interface). The UI does not mutate its local copy except by applying propagated changes.
- The Guide's `draw_attention` tool does not propose an `interface` update; it dispatches a transient effect rendered by the UI without changing shared state, as defined in [Attention](#attention).

## Conformance

An implementation of the UI conforms to this specification when:

- it renders the Archive as a stack of glassy tablets above a fixed ground plane, with one document per tablet, and an overlay plane above the topmost tablet hosting the Guide's avatar and the icon rail, as defined in [Scene](#scene) and [Reading surface](#reading-surface);
- it renders the front-most tablet as the active document, with behind tablets visible but defocused, as defined in [The stack](#the-stack);
- it renders documents as continuous Markdown with blocks focusable within the tablet, as defined in [Tablets](#tablets) and [Focus](#focus);
- it provides ToC navigation and in-content relationship links, as defined in [Visitor navigation](#visitor-navigation);
- it presents the ToC and search as non-document tablets that may minimise to icons on an icon rail (UI chrome), as defined in [Non-document tablets](#non-document-tablets);
- it renders the Guide as a visible figure on the overlay plane with speech, detached from the tablets, as defined in [The Guide's avatar](#the-guides-avatar);
- it renders the Guide's avatar position (from a small named set of fixed positions, with Visitor drag-and-snap producing an `avatar_repositioned` event), visibility, and animation, controllable by the Guide via avatar-interaction tools, and rejects speech while the avatar is hidden, as defined in [Avatar position and visibility](#avatar-position-and-visibility) and [Avatar animation](#avatar-animation);
- it renders the Guide's Draw-attention as a transient highlight that focuses a block and fades, establishing no persistent state, as defined in [Attention](#attention);
- it produces exactly the high-level semantic event types defined in [Events](#events), with the defined payloads, and produces no events for Guide actions or internal state changes, as defined in [Event sources and non-events](#event-sources-and-non-events);
- it provides an address input producing `direct_address` events, as defined in [Addressing the Guide](#addressing-the-guide);
- it registers the `navigate` and `draw_attention` UI-control tools and the `speak`, `set_avatar_position`, `set_avatar_visibility`, and `animate_avatar` avatar-interaction tools on the bus with the defined parameters and effects, as defined in [UI-control tools](#ui-control-tools) and [Avatar-interaction tools](#avatar-interaction-tools);
- it declares the `interface` slice with the fields defined in [The `interface` slice](#the-interface-slice) (including per-tablet `openedBy`), and enforces User precedence at `navigate` tool-call dispatch time, as defined in [UI-control tools](#ui-control-tools);
- it presents the spend cap as an in-world rest message through the Guide's avatar speech, as defined in [Cap enforcement](#cap-enforcement);
- it runs on the main thread, with animation optionally via `OffscreenCanvas` in a worker, as defined in [Rendering technology](#rendering-technology) and [Runtime](./runtime.spec.md#worker-topology);
- a Service Worker manages the token lifecycle transparently, attaching `Authorization: Bearer` headers to backend requests, with the token not visible to the page and application code unaware of tokens, as defined in [Service Worker](#service-worker);
- it consumes the `interface` slice reactively via a `LocalCopy` and TC39 signals, proposing updates through the bus, as defined in [Reactivity and shared state](#reactivity-and-shared-state).