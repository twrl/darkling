/**
 * The root `<darkling-app>` element: hosts the scene, the bus, the state
 * manager, the event queue, the tools, and the UI components.
 *
 * @see specs/ui.spec.md
 * @see specs/usage-and-deployment.spec.md#bootstrap-sequence
 */

import { LitElement, css, html, nothing } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { SignalWatcher } from '@lit-labs/signals';

import { type ServiceBusHostOptions } from '@darkling/service-bus/lit';
import { type StateManagerHostOptions, consumeState } from '@darkling/state-manager/lit';

import { EventQueue } from '../events/event-queue.js';
import { sessionStart } from '../events/event-types.js';
import type { UIEvent } from '../events/event-types.js';

import type { DocumentData, BlockData } from './document-tablet.js';
import type { TocEntry } from './non-document-tablet.js';

// Side-effect imports: register the custom elements.
import './scene.js';
import './document-tablet.js';
import './non-document-tablet.js';
import './guide-avatar.js';
import './address-input.js';

/** The interface slice value shape. */
interface InterfaceSlice {
  stack: Array<{ document: string; openedBy: 'ui' | 'guide' | 'service' }>;
  activeDocument: string | null;
  focus: { document: string; block: string } | null;
}

/**
 * The root Darkling application element. Wires the service bus, state manager,
 * event queue, and the UI components into a single app.
 */
@customElement('darkling-app')
export class DarklingApp extends SignalWatcher(LitElement) {
  // Consume the LocalCopy from the nearest <state-manager-host>.
  @consumeState()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state?: any;

  @property({ type: Object }) busOptions?: ServiceBusHostOptions;
  @property({ type: Object }) stateOptions?: StateManagerHostOptions;

  @state() private toc: TocEntry[] = [];
  @state() private tocMinimised = false;
  @state() private searchMinimised = false;
  @state() private attentionBlock: string | null = null;
  /** Whether session_start has been emitted; Visitor events are ignored until it is. */
  @state() private sessionStarted = false;

  // Document content cache (fetched from the backend).
  private documents = new Map<string, DocumentData>();
  private blocks = new Map<string, BlockData[]>();

  private eventQueue: EventQueue | null = null;

  static override styles = css`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    // Set up the event queue. On flush, events are sent to the Guide.
    this.eventQueue = new EventQueue({
      onFlush: (events) => this.handleFlush(events),
    });
    // Fetch the ToC from the backend.
    void this.fetchToc();
  }

  /**
   * After the UI is first mounted, emit `session_start` (trigger probability
   * 1.0), which flushes the queue and triggers the Guide's first interaction,
   * as defined by [User interface](../../specs/ui.spec.md#session-start). Until
   * this fires, Visitor-activity events are ignored so session_start is the
   * sole event in the first flush.
   */
  override firstUpdated(): void {
    this.sessionStarted = true;
    this.eventQueue?.add(sessionStart());
  }

  private async fetchToc(): Promise<void> {
    try {
      const res = await fetch('/retrieval/toc');
      if (res.ok) {
        this.toc = (await res.json()) as TocEntry[];
      }
    } catch {
      // Backend not available; ToC stays empty.
    }
  }

  private handleFlush(_events: UIEvent[]): void {
    // In a full implementation, this calls the Guide service's runInteraction
    // via the bus. For now, it's a placeholder that ends the interaction.
    this.eventQueue?.beginInteraction();
    // Simulate interaction completion after a short delay.
    setTimeout(() => this.eventQueue?.endInteraction(), 100);
  }

  override render() {
    const iface = this.state?.get('interface') as InterfaceSlice | undefined;
    const stack = iface?.stack ?? [];

    return html`
      <service-bus-host .options=${this.busOptions ?? nothing}>
        <state-manager-host .options=${this.stateOptions ?? nothing}>
          <darkling-scene>
            <!-- Document tablets (in the stack slot) -->
            ${stack.map((entry, i) => {
              const doc = this.documents.get(entry.document);
              if (!doc) return nothing;
              return html`<document-tablet
                .document=${doc}
                .blocks=${this.blocks.get(entry.document) ?? []}
                .depth=${i}
                .focusedBlock=${iface?.focus?.document === entry.document ? iface.focus.block : null}
                .attentionBlock=${this.attentionBlock}
                @close=${(e: CustomEvent) => this.handleClose(e.detail as string)}
                @attention=${(e: CustomEvent) => this.handleAttention(e.detail)}
                @traverse=${(e: CustomEvent) => this.handleTraverse(e.detail)}
              ></document-tablet>`;
            })}

            <!-- Overlay slot: avatar + non-document tablets -->
            <slot slot="overlay" name="overlay"></slot>

            <!-- Icon rail slot -->
            <slot slot="rail" name="rail">
              ${
                this.tocMinimised
                  ? html`<toc-tablet
                      .minimised=${true}
                      @restore=${() => (this.tocMinimised = false)}
                    ></toc-tablet>`
                  : nothing
              }
              ${
                this.searchMinimised
                  ? html`<search-tablet
                      .minimised=${true}
                      @restore=${() => (this.searchMinimised = false)}
                    ></search-tablet>`
                  : nothing
              }
            </slot>
          </darkling-scene>

          <!-- ToC tablet (in overlay slot) -->
          ${
            !this.tocMinimised
              ? html`<toc-tablet
                  slot="overlay"
                  .entries=${this.toc}
                  @select=${(e: CustomEvent) => this.handleOpenDocument(e.detail as string)}
                  @minimise=${() => (this.tocMinimised = true)}
                ></toc-tablet>`
              : nothing
          }

          <!-- Search tablet (in overlay slot) -->
          ${
            !this.searchMinimised
              ? html`<search-tablet
                  slot="overlay"
                  @minimise=${() => (this.searchMinimised = true)}
                  @search=${(e: CustomEvent) => this.handleSearch(e.detail as string)}
                  @select=${(e: CustomEvent) => this.handleOpenDocument(e.detail as string)}
                ></search-tablet>`
              : nothing
          }

          <!-- Guide avatar (in overlay slot) -->
          <guide-avatar
            slot="overlay"
            @reposition=${(e: CustomEvent) => this.handleAvatarReposition(e.detail)}
          ></guide-avatar>

          <!-- Address input (chrome) -->
          <address-input
            @address=${(e: CustomEvent) => this.handleAddress(e.detail as string)}
          ></address-input>
        </state-manager-host>
      </service-bus-host>
    `;
  }

  // --- Event handlers ---

  /** Ignore Visitor-activity events until session_start has been emitted. */
  private ready(): boolean {
    return this.sessionStarted;
  }

  private handleOpenDocument(documentId: string): void {
    if (!this.ready()) return;
    void this.loadDocument(documentId);
    this.eventQueue?.add({
      type: 'document_opened',
      timestamp: Date.now(),
      payload: { document: documentId },
    });
  }

  private handleClose(documentId: string): void {
    if (!this.ready()) return;
    this.eventQueue?.add({
      type: 'document_closed',
      timestamp: Date.now(),
      payload: { document: documentId },
    });
  }

  private handleAttention(detail: { document: string; block: string }): void {
    if (!this.ready()) return;
    this.eventQueue?.add({
      type: 'attention_drawn',
      timestamp: Date.now(),
      payload: detail,
    });
  }

  private handleTraverse(_detail: { link: string }): void {
    if (!this.ready()) return;
    // Placeholder: resolve the link and open the target.
    // In a full implementation, this would call the retrieval service.
  }

  private handleSearch(query: string): void {
    // Placeholder: call the backend search endpoint.
    void fetch(`/retrieval/search-blocks?query=${encodeURIComponent(query)}`)
      .then((r) => r.json())
      .then(() => {
        // Update search results (placeholder).
      })
      .catch(() => {});
  }

  private handleAddress(text: string): void {
    if (!this.ready()) return;
    this.eventQueue?.add({
      type: 'direct_address',
      timestamp: Date.now(),
      payload: { text },
    });
  }

  private handleAvatarReposition(detail: { position: string }): void {
    if (!this.ready()) return;
    this.eventQueue?.add({
      type: 'avatar_repositioned',
      timestamp: Date.now(),
      payload: { position: detail.position },
    });
  }

  private async loadDocument(documentId: string): Promise<void> {
    if (this.documents.has(documentId)) return;
    try {
      const res = await fetch(`/retrieval/documents/${documentId}`);
      if (res.ok) {
        const doc = (await res.json()) as DocumentData;
        this.documents.set(documentId, doc);
        // Fetch the root block and its children.
        const blockRes = await fetch(`/retrieval/blocks/${doc.rootBlock}`);
        if (blockRes.ok) {
          const rootBlock = (await blockRes.json()) as BlockData;
          const blocks = [rootBlock];
          // Fetch children (simplified — a real impl would traverse the tree).
          for (const childId of rootBlock.children) {
            const childRes = await fetch(`/retrieval/blocks/${childId}`);
            if (childRes.ok) {
              blocks.push((await childRes.json()) as BlockData);
            }
          }
          this.blocks.set(documentId, blocks);
          this.requestUpdate();
        }
      }
    } catch {
      // Backend not available.
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'darkling-app': DarklingApp;
  }
}
