/**
 * Non-document tablets: the ToC tablet and the search tablet, minimisable to
 * the icon rail, as defined by [User interface](../../specs/ui.spec.md#non-document-tablets).
 *
 * @see specs/ui.spec.md#non-document-tablets
 */

import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/** A ToC entry: document id, slug, title. */
export interface TocEntry {
  id: string;
  slug: string;
  title: string;
}

/**
 * The ToC tablet: lists the Archive's documents by title. The Visitor selects a
 * document to open it. Minimisable to the icon rail.
 */
@customElement('toc-tablet')
export class TocTablet extends LitElement {
  @property({ type: Array }) entries: TocEntry[] = [];
  @property({ type: Boolean }) minimised = false;

  static override styles = css`
    :host {
      display: block;
    }

    .toc-tablet {
      width: 400px;
      max-height: 70vh;
      overflow-y: auto;
      padding: 24px;
      background: rgba(30, 30, 50, 0.65);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      color: rgba(255, 255, 255, 0.9);
      font-family: Georgia, serif;
    }

    .toc-tablet h2 {
      font-size: 20px;
      margin: 0 0 16px;
    }

    .toc-tablet ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .toc-tablet li {
      padding: 8px 12px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .toc-tablet li:hover {
      background: rgba(120, 160, 255, 0.1);
    }

    .minimise-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(0, 0, 0, 0.3);
      color: rgba(255, 255, 255, 0.5);
      cursor: pointer;
      font-size: 14px;
    }
  `;

  override render() {
    if (this.minimised) {
      return html`<button
        class="rail-icon"
        title="Table of Contents"
        @click=${() => this.dispatchEvent(new CustomEvent('restore'))}
      >
        ☰
      </button>`;
    }
    return html`
      <div class="toc-tablet" style="position: relative;">
        <button
          class="minimise-btn"
          @click=${() => this.dispatchEvent(new CustomEvent('minimise'))}
        >
          _
        </button>
        <h2>Archive</h2>
        <ul>
          ${this.entries.map(
            (entry) => html`
              <li
                @click=${() => this.dispatchEvent(new CustomEvent('select', { detail: entry.id }))}
              >
                ${entry.title}
              </li>
            `,
          )}
        </ul>
      </div>
    `;
  }
}

/**
 * The search tablet: a search interface over the Archive. Minimisable to the
 * icon rail.
 */
@customElement('search-tablet')
export class SearchTablet extends LitElement {
  @property({ type: Boolean }) minimised = false;
  @state() private query = '';
  @state() private results: Array<{ id: string; title: string; document: string }> = [];

  static override styles = css`
    :host {
      display: block;
    }

    .search-tablet {
      width: 400px;
      max-height: 70vh;
      overflow-y: auto;
      padding: 24px;
      background: rgba(30, 30, 50, 0.65);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      color: rgba(255, 255, 255, 0.9);
      font-family: Georgia, serif;
    }

    .search-tablet h2 {
      font-size: 20px;
      margin: 0 0 12px;
    }

    .search-tablet input {
      width: 100%;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(0, 0, 0, 0.3);
      color: rgba(255, 255, 255, 0.9);
      font-size: 14px;
      box-sizing: border-box;
    }

    .search-tablet ul {
      list-style: none;
      padding: 0;
      margin: 12px 0 0;
    }

    .search-tablet li {
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
    }

    .search-tablet li:hover {
      background: rgba(120, 160, 255, 0.1);
    }

    .minimise-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(0, 0, 0, 0.3);
      color: rgba(255, 255, 255, 0.5);
      cursor: pointer;
      font-size: 14px;
    }
  `;

  override render() {
    if (this.minimised) {
      return html`<button
        class="rail-icon"
        title="Search"
        @click=${() => this.dispatchEvent(new CustomEvent('restore'))}
      >
        ⌕
      </button>`;
    }
    return html`
      <div class="search-tablet" style="position: relative;">
        <button
          class="minimise-btn"
          @click=${() => this.dispatchEvent(new CustomEvent('minimise'))}
        >
          _
        </button>
        <h2>Search</h2>
        <input
          type="text"
          placeholder="Search the Archive..."
          .value=${this.query}
          @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' && this.query.trim()) {
              this.dispatchEvent(new CustomEvent('search', { detail: this.query }));
            }
          }}
        />
        ${
          this.results.length > 0
            ? html`<ul>
                ${this.results.map(
                  (r) =>
                    html`<li
                      @click=${() => this.dispatchEvent(new CustomEvent('select', { detail: r.id }))}
                    >
                      ${r.title}
                    </li>`,
                )}
              </ul>`
            : nothing
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'toc-tablet': TocTablet;
    'search-tablet': SearchTablet;
  }
}
