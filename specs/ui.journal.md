# User interface — journal

## Creation

Created as the twelfth specification via the specification workflow, to establish the UI specification that the existing specs repeatedly defer to ("the UI specification") for event types/payloads, the rendering pipeline, and the UI-control tools. The user's original concept — a stack of glassy 3D tablets projected above a surface, with the Guide inhabiting the scene — drove the spatial metaphor that anchors the spec.

This journal records the consequential design decisions and the resolutions of gaps flagged by the existing specs.

## Decisions

### Spatial metaphor: glassy tablet stack above a ground plane

The user's original concept: documents are glassy 3D tablets "projected" above a surface, arranged in a stack. This became the central design decision and the basis for the [Scene](../specs/ui.spec.md#scene) and [Reading surface](../specs/ui.spec.md#reading-surface) sections. The metaphor serves the three-way interaction model: the Archive is the shared substrate the Visitor and Guide both act upon, and the stack makes "open" vs "active" vs "behind" visually concrete.

- **One document per tablet.** The user chose "Document tablet, blocks within": each tablet renders one document, with that document's blocks as continuous Markdown within it. Blocks are structural (for retrieval/attention/focus) but not visually boxed.
- **Front-most = active; behind recedes.** The front-most tablet is the active document and fully readable; tablets behind are visible but tilted/defocused, receding into depth. They're a navigation affordance, not simultaneously readable. This resolves the "multiple, one active" choice: multiple documents may be open, but only one is active at a time.
- **Fixed ground plane.** The user chose "Fixed ground plane (framing)": the surface is a non-interactive visual ground, not a diegetic element and not itself navigable. Keeps the surface simple and avoids over-specification.

### Blocks within a tablet: continuous Markdown with a focus affordance

The user chose "Continuous with focus affordance" for the document view: the document is rendered as continuous Markdown, and the Navigate-to-block / Draw-attention operations can "focus" a block within the flow (scroll into comfortable reading position + visual emphasis). This is captured in [Focus](../specs/ui.spec.md#focus). Focus established by navigation persists until the next navigation/attention action; focus established by Draw-attention is transient and fades.

### The Guide's avatar: in scene, detached

The user chose "In scene, detached" for avatar placement: the Guide is a visible figure in the 3D scene, floating above/beside the surface, able to gesture toward tablets but not spatially anchored to a specific tablet. This keeps the avatar and the tablets in one diegetic space (reinforcing the three-way model) without coupling the avatar's position to the active document's tablet.

The user chose "Visual avatar + speech" for the avatar model: a rendered figure (possibly animated via OffscreenCanvas) plus text/typed speech. Speech is rendered in-scene near the avatar. The avatar-interaction tools drive both the figure and the speech; the UI must not present Guide content through any channel other than the avatar's speech and visible UI-control effects.

### Attention: transient highlight + scroll-into-view, fades

The user chose "Highlight + scroll into view, fades" for the Draw-attention rendering: a transient highlight (edge glow / soft light) on the block, scrolled into comfortable reading position within the tablet, fading after a short time or on the next Visitor action. This resolves the gap flagged in `three-way-interaction.journal.md` ("Draw attention" underspecified: transient vs persistent) — attention is **transient**, establishing no persistent state.

A consequence: the `interface` slice records *focus* (the block navigation presents) but does **not** record an "attention" field. Draw-attention is a transient UI effect driven by the Guide's tool call, not a state change. This keeps the `interface` slice minimal and avoids the transient/persistent tension by making attention purely transient.

### Events: six types

The user selected all six proposed event types: `document_opened`, `document_closed`, `attention_drawn`, `relationship_traversed`, `direct_address`, `scroll`. The first three + `direct_address` were named or implied by existing specs; `document_closed`, `relationship_traversed`, and `scroll` are new. Each has a defined payload (document id, block id, relationship type, address text, blocks in view).

- `direct_address` has trigger probability 1.0 (always flushes), per the constrained agent spec's examples (formerly `event-system.spec.md`, now consolidated into `constrained-agent.spec.md`).
- `scroll` is the low-level browsing signal that drives microbatching (low trigger probability), carrying the blocks brought into view.
- The spec explicitly states the Guide does not produce events, and internal UI state changes (animation completion, cache updates) do not produce events — closing a loophole the existing specs left open.

### `interface` slice: concrete fields + User-precedence enforcement

This spec is the refinement of `runtime.spec.md` that establishes the `interface` slice's concrete fields (the deferred refinement noted in `state-manager.journal.md`).

- **Fields:** `stack` (ordered open documents, front = active), `activeDocument` (front-most, nullable), `focus` (block focused within the active document, nullable). No attention field (transient). No speech field (delivered by avatar-interaction tools, not held in shared state).
- **User precedence** is enforced at `navigate` tool-call dispatch time, not by runtime state invariants. The `navigate` dispatch inspects the current stack (each tablet's `openedBy`) and rejects a Guide navigation that would override a `ui`-opened active document. This keeps the runtime authority simple and locates conflict resolution where the Guide's action is initiated.

### `uiEstablishedActiveDocument` is authority-side state, not in the broadcast value

~~The User-precedence invariant needs to know what active document the User has most recently established, but that tracking state should not be broadcast to local copies (it's an authority-internal enforcement concern, not part of the presented interface). The spec records this as authority-side state outside the broadcast value. This is a slight extension of the `state-manager` mechanism (which broadcasts the slice value but says nothing about per-slice authority-side enforcement state); flagged here as an implementation decision the state-manager package will need to support. See [Gaps and open questions](#gaps-and-open-questions).~~ **Resolved** by the `openedBy` refinement below; this approach is no longer used.

### User precedence via `openedBy` at tool-call dispatch (refinement)

Resolved the `uiEstablishedActiveDocument` gap, per the user: "we have a stack of open tablets, we simply include 'how opened' on each one. That stack is sent to the agent on each interaction, and we enforce restrictions on navigation at tool call time."

- **`openedBy` on each stack entry.** Each tablet in the `interface` slice's `stack` now carries `openedBy: 'ui' | 'guide' | 'service'`, recording who opened it. It's set when the tablet is pushed and doesn't change while the tablet stays in the stack (bringing forward doesn't change `openedBy`). This is part of the broadcast slice value, so it's visible to local copies and to the Guide (the Guide sees how each open document was opened). The `openedBy` enum is a UI domain concept defined inline in this spec, not a runtime type.
- **Enforcement moved to `navigate` tool dispatch.** User precedence is now enforced at `navigate` tool-call dispatch time, not by a runtime state invariant. The `navigate` dispatch inspects the current stack: if the active document's tablet has `openedBy: "ui"` and the call would change `activeDocument` away from it, the call is rejected with a clear error ("the Visitor opened that document"); a call targeting the current `ui`-opened active document (e.g. focusing a block within it) is accepted. A surviving call then proposes an `interface` slice update, setting `openedBy: "guide"` on any tablet it pushes.
- **No runtime invariants needed.** The `interface` slice does not declare invariant functions. Internal consistency (`activeDocument` == `stack[0]`, `focus` within `activeDocument`) is maintained by the mutations themselves, which are the only mechanism for changing the slice's value. No authority-side `uiEstablishedActiveDocument` state is needed. The flagged `state-manager.spec.md` refinement is no longer required.
- **Why this is cleaner.** Locating conflict resolution at tool-call dispatch (where the Guide's action is initiated) matches the `draw_attention`-on-inactive-document pattern already in the spec, gives the Guide a recoverable failure with a clear reason, keeps the state-manager authority simple and pure, and uses the stack the Guide already observes. The Guide can see which documents the Visitor opened and reason about yielding in-character (Guide continuity), rather than the failure being an opaque state rejection.

This superseded the earlier "User-precedence invariant + `uiEstablishedActiveDocument` authority-side state" design. The earlier design's journal entries are struck through above for history.

### UI-control tools: `navigate` and `draw_attention`

The spec defines the two UI-control tools backing the Guide's Navigate and Draw-attention operations, as deferred by `constrained-agent.spec.md` ("specific tools for... UI control are defined by their respective domain specifications").

- `navigate({ document, block? })` proposes an `interface` slice update, setting `openedBy: "guide"` on any tablet it pushes, subject to User-precedence enforcement at dispatch time. Visible.
- `draw_attention({ document, block })` renders a transient highlight, dispatches the transient effect directly (does **not** propose an `interface` update), and fails if the target document is not the active document. Visible (transient).

The `draw_attention`-on-inactive-document failure is a defined error that tells the Guide it must navigate first — this gives the constrained agent a recoverable failure rather than a silent no-op.

### Avatar-interaction tools: position, visibility, animation, speech (refinement)

Added after initial establishment, per the user's refinement: "the Guide can reposition (including to/from hidden) its avatar, and can animate it." The initial spec left the avatar's presentation implicit (a fixed detached figure that gestures). The refinement makes the avatar's position, visibility, and animation *Guide-controllable* via avatar-interaction tools, and defines the `speak` tool explicitly.

- **Avatar position & visibility** — the avatar has a position in the 3D scene and a visibility state (visible/hidden). The Guide controls both via tools. Hiding makes the Guide absent from the scene; a hidden Guide cannot speak (a `speak` call while hidden is rejected — a hidden Guide is absent and cannot address the Visitor). This gives the Guide diegetic control over its presence (e.g. stepping out of a scene and re-entering), which supports immersion.
- **Avatar animation** — the Guide may issue an animation tool call to drive motion/gesture/transition over a duration, including animating a reposition or show/hide transition rather than snapping. The animation vocabulary is an implementation concern; the spec requires only that the Guide may issue an animation and the UI renders it over time. Animations may be interrupted by a subsequent avatar tool call (interruption behaviour is an implementation concern).
- **`speak` tool** — defined explicitly as an avatar-interaction tool (previously implied). Renders text as speech near the avatar; rejected if the avatar is hidden.
- **Category constraint** — these tools affect the avatar's own presentation only, per `constrained-agent.spec.md`'s avatar-interaction category ("must not alter the Archive, the UI's navigation or attention state, or any persistent state other than the avatar's own presentation"). They are **not** subject to the three-way interface conflict-resolution rules (they don't act on the Archive interface). They do not propose `interface` slice updates.
- **Avatar state not in the `interface` slice** — the avatar's position and visibility are part of the avatar's own presentation, not the Archive interface. Whether they're held as separate avatar state (and how, e.g. a separate avatar state slice or local UI state) is an implementation concern; the spec requires only that the Guide may control them and that a hidden avatar cannot speak. This keeps the `interface` slice focused on the Archive interface.

The four avatar-interaction tools: `speak({text})`, `set_avatar_position({position})`, `set_avatar_visibility({visible})`, `animate_avatar({animation, params?})`.

### Fixed avatar positions + Visitor drag-and-snap (refinement)

Refined the avatar position model, per the user: "I'm inclined to give the avatar a small number of fixed positions to choose from. The user can also reposition the avatar by dragging (it snaps to a valid position) which is reported as an event."

- **Fixed named position set.** The avatar occupies one of a small, named set of fixed positions (e.g. "left", "center", "right", "aside"). The set is a UI/policy parameter: the spec requires it exists, is small, and is named; concrete coordinates are configuration. The `set_avatar_position` tool parameter is now `PositionId` (a name), not a free coordinate. This replaced the earlier "any point in the scene" model.
- **Visitor drag-and-snap.** The Visitor may drag the avatar; on release it snaps to the nearest fixed position. The drag-and-snap is Visitor activity, so it produces a new `avatar_repositioned` event (payload: the snapped `PositionId`). A single event on release (after snap), not drag-start/drag-move — chosen to avoid flooding the event queue with drag-move events. Guide repositioning does **not** produce an event (Guide actions never produce events), so the Guide's `set_avatar_position` and the Visitor's drag both move the avatar but only the Visitor's drag emits an event.
- **Visibility remains Guide-only.** Only the Guide hides/shows its avatar; the Visitor controls position (by dragging) but not visibility.

### Non-document tablets (ToC + search), minimised to an icon rail (refinement)

Refined the navigation chrome, per the user: "Rather than an always visible ToC, I think we have non-document tablets which would include a ToC and search interface. These might be able to minimise to icons." A later refinement placed the minimised icons on a rail rather than the ground plane.

- **ToC and search are tablets, not a sidebar.** Replaces the earlier "persistent ToC sidebar" decision. The ToC and search are separate non-document tablets, presented in the same spatial model as document tablets, not always-visible chrome.
- **Minimise to an icon rail (UI chrome).** Either non-document tablet may minimise to an icon on a dedicated icon rail — a strip of UI chrome separate from the 3D scene's ground plane. Clicking an icon restores the tablet. The user initially suggested the icons sit "on the same plane as the avatar," then decided to keep them on a rail instead; the spec follows the rail decision. The ground plane remains a fixed framing element hosting only the avatar's fixed positions, not minimised icons.
- **Not in the `interface` slice.** Non-document tablets are not part of the document stack and are not subject to front-most-active/behind-recede ordering. Their minimised state is not held in the `interface` slice (which tracks document tablets only) — it's local UI state.
- **Implementation concerns left open:** whether an open non-document tablet visually occludes or sits alongside the document stack, and the exact visual treatment of the rail/icons.

This changed the "ToC sidebar" in [Visitor navigation](../specs/ui.spec.md#visitor-navigation) to a "ToC tablet," and restored the ground plane to a non-interactive framing element (the earlier draft had it host minimised icons; the rail refinement reverts that).

### Overlay plane above the topmost tablet (refinement)

Refined the placement of the avatar and the icon rail, per the user: "I'm inclined to say that the avatar and tool rail are in a plane above the topmost tablet."

- **Overlay plane.** Introduced a fixed plane parallel to the ground plane, positioned above the topmost tablet, that hosts both the Guide's avatar and the icon rail. This gives the avatar and the tools a shared, stable layer above the reading surface — they read as instruments/guides above the content rather than content within it or chrome floating arbitrarily.
- **Ground plane reverted to pure framing.** The ground plane no longer hosts the avatar (it did in earlier drafts); it's the visual ground below the tablet stack only. The avatar's fixed positions and the icon rail both live on the overlay plane.
- **Does not move with the stack.** The overlay plane is above the topmost tablet but is not part of the stack — it doesn't recede/tilt with the tablets. This keeps the avatar and tools at a constant, readable layer while documents stack and recede below them.
- **Relative placement on the overlay plane is an implementation concern.** The spec requires both the avatar and the rail live on the overlay plane; whether the avatar sits left/center and the rail right (or another arrangement) is left to implementation.

This supersedes the earlier "avatar floats above/beside the surface" and "rail on the ground plane / rail as chrome" decisions, giving both a defined home: the overlay plane above the topmost tablet.

### Cap enforcement: in-world rest message via avatar speech

The spec includes cap-enforcement presentation (the user didn't select it for scope, but `usage-and-deployment.spec.md` assigns it to the UI, so it's covered minimally to keep the UI spec self-contained). The rest message is delivered through the Guide's avatar speech (consistent with "the Guide communicates exclusively through the avatar"), not a system error UI. The specific text and cap trigger conditions remain owned by `usage-and-deployment.spec.md`.

### Spec scope: events, rendering, interface slice, UI-control tools

The user selected: event types & payloads, the rendering pipeline, the `interface` slice fields, and UI-control tools. Cap-enforcement messaging was not selected but is included minimally (above) since `usage-and-deployment.spec.md` assigns the *presentation* to the UI. The user did not add anything via free text beyond the tablet concept.

## Gaps and open questions

- ~~**`uiEstablishedActiveDocument` support in the state-manager package.**~~ **Resolved.** The `openedBy` refinement moves User-precedence enforcement to `navigate` tool-call dispatch, so no authority-side state or state-manager invariant-API extension is needed. See [User precedence via `openedBy` at tool-call dispatch (refinement)](#user-precedence-via-openedby-at-tool-call-dispatch-refinement).
- **Rendering library.** The spec leaves the specific 3D rendering library (Three.js, etc.) as an implementation concern, requiring only the spatial model and main-thread UI logic. To be decided at implementation time.
- **Speech visual treatment.** "Speech is rendered as text associated with the avatar (e.g. a speech region near the figure). The specific visual treatment is an implementation concern." Whether speech is a speech-bubble, a subtitle region, typed text, etc. is left open.
- **`scroll` event throttling.** The `scroll` event carries the blocks brought into view; throttling/debouncing so scrolling doesn't flood the event queue is an implementation concern (the agentic model's microbatching will coalesce them, but the UI should still avoid producing events faster than meaningful).
- **Relationship link rendering.** Relationships are rendered as "navigable links within the document's content," but how a relationship is visually presented as a link (inline link, footnote, margin annotation) is an implementation concern.
- **ToC when the stack is empty / initial state.** The spec defines the empty stack (ground plane + Guide, no active document) but not the initial bootstrap view before any document is opened. To be decided at implementation; likely the ToC tablet (or its minimised icon) invites the Visitor to open a document.
- **Closing the active tablet and the Guide's continuity.** When the Visitor closes the active tablet, the next tablet becomes active. The spec doesn't address whether this counts as a "Visitor navigation" that updates `uiEstablishedActiveDocument` (it does — it's a ui-sourced action establishing the active document). Recorded for clarity.
- **Multiple tablets for the same document.** The spec implies one tablet per document (opening an already-open document brings it forward, not duplicates). Stated in [Visitor navigation](../specs/ui.spec.md#visitor-navigation); recorded here.
- **Avatar state home.** The avatar's position and visibility are not in the `interface` slice (Archive interface state) and the spec leaves where they live as an implementation concern — a separate avatar state slice, local UI state, or a dedicated avatar service on the bus. The `speak`-while-hidden rejection needs to read the current visibility state, so the avatar state must be queryable by the avatar-interaction service. To be decided at implementation; may prompt a small spec note if a second state slice is warranted.
- **Animation vocabulary & interruption behaviour.** The spec leaves the named-animation vocabulary and the interruption behaviour (blend/cut/cancel a running animation) as implementation concerns. To be decided at implementation time.
- **Fixed position set contents.** The spec requires a small named set of avatar positions exists but leaves the names/count/coordinates to configuration. To be defined as a UI/policy parameter at implementation; may be added to the policy-parameter table if it needs to be configurable.
- **Drag-and-snap visual behaviour.** The spec says the avatar snaps to the nearest fixed position on release; the drag visual (free follow, constrained to a plane, ghost preview of the snap target) is an implementation concern.
- **Non-document tablet occlusion/layout.** Whether an open ToC/search tablet visually occludes the document stack, sits alongside it, or is brought forward like a document tablet is left as an implementation concern. The spec requires only that they're tablets (not chrome) and may minimise to ground-plane icons.
- **Search tablet query scope.** The search tablet uses textual search per `content-first-retrieval.spec.md`; whether it also offers property/relationship search is an implementation concern (the spec mentions textual search as the baseline).

## Overlaps with other specifications

- `constrained-agent.spec.md` — owns the queue/flush/trigger/budget (formerly the event system spec, now consolidated into the constrained agent spec); this spec owns the event *types* and payloads it keys off. `direct_address` trigger probability 1.0 aligns with its examples.
- `three-way-interaction.spec.md` — owns the roles, permitted operations (Navigate, Draw attention, Retrieve), and conflict-resolution rules. This spec defines the *rendering* of those operations and enforces the rules at tool-call dispatch time, not via runtime state invariants.
- `constrained-agent.spec.md` — owns the tool categories and discipline. This spec defines the specific `navigate`/`draw_attention` UI-control tools deferred by it.
- `runtime.spec.md` — owns the authority/local-copy/patch mechanism. This spec refines the `interface` slice's fields within that mechanism (the deferred refinement).
- `content-model.spec.md` / `authoring-tooling.spec.md` — own the document/block/relationship model and the compiled Markdown format. This spec renders them.
- `content-first-retrieval.spec.md` — owns the retrieval interface (used by the Guide, not directly by the UI). This spec uses the ToC (owned by `usage-and-deployment.spec.md`) for Visitor navigation.
- `usage-and-deployment.spec.md` — owns the runtime topology (main thread, workers), Service Worker, cap enforcement, and ToC. This spec conforms to its main-thread requirement and presents the cap in-world.
- `annotations.spec.md` — annotations are private to the Guide; this spec requires the UI not render them.
## Session start event

Added the `session_start` event type to the event vocabulary, with an empty
payload, emitted once per page load when bootstrap is complete. This closes a
gap: the existing specs established the Guide's event-triggered interaction model (now in the constrained agent spec), but did not specify any mechanism by which
the Guide is triggered at the start of a session — the bootstrap sequence
mounted the UI and said "the Guide begins consuming events," but produced no
event to flush the queue for the first interaction.

### Framing: Visitor-initiated, not a system event

The initial framing question was whether `session_start` is a system event
(produced by the frontend) or a Visitor-activity event. The user's resolution:
the Visitor *arriving* at the Archive is itself Visitor activity, so
`session_start` is a Visitor-initiated event, not a system event. This avoids
any amendment to the agentic model's "events are produced in response to User
activity" source model — no exception clause is needed; arriving is activity.

### Decisions (per the spec-workflow dialogue)

- **Empty payload.** The Guide can fetch anything it needs via retrieval tools,
  and the status object already carries working memory and budget. Carrying
  session context (tier, ToC summary, restored working memory) would create a
  "session context" shape no spec currently defines. Kept empty; can widen
  later without breaking anything.
- **Once per page load.** A page reload re-emits `session_start`, since the
  Guide worker is freshly started each load — a reload genuinely is a new
  session from the Guide's perspective. Working-memory persistence survives
  via its own mechanism regardless.
- **Emitted before the UI accepts Visitor input.** Guarantees `session_start`
  is the sole event in the queue when its flush triggers the Guide's first
  interaction. Implementation consequence: the address input / ToC are not
  interactive until `session_start` is emitted; this is unobservable to the
  Visitor in practice. (The alternative — emit "as early as possible" without
  gating input — would allow a race where a fast Visitor action lands first;
  rejected in favour of the clean "session_start is first" guarantee.)
- **Trigger probability 1.0.** The Guide is always triggered once at session
  start. (Mirrors `direct_address`.)
- **Premium left to implementation.** A greeting is cheap; a small premium is
  appropriate. The value is a policy parameter (the premium function is a
  policy parameter in the constrained agent spec), not fixed in the spec —
  consistent with how `direct_address` etc. are handled.

The amendments touch ui.spec.md (event-type table + a Session start
subsection + a Gherkin scenario), the constrained agent spec (a clarifying sentence
in Trigger probability + a flush scenario; formerly event-system.spec.md), and usage-and-deployment.spec.md
(a bootstrap-sequence step + a Gherkin assertion). The constrained-agent
spec's interaction input shape is unchanged — `session_start` appears in the
event queue like any other event.
