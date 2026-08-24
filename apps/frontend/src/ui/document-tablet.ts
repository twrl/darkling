/**
 * A document tablet: presents one document as continuous Markdown, with
 * focusable blocks, as defined by [User interface](../../specs/ui.spec.md#tablets).
 *
 * @see specs/ui.spec.md#tablets
 * @see specs/ui.spec.md#the-stack
 */

import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/** A minimal document shape for rendering. */
export interface DocumentData {
  id: string;
  slug: string;
  title: string;
  rootBlock: string;
}

/** A minimal block shape for rendering. */
export interface BlockData {
  id: string;
  title: string;
  document: string;
  parent: string | null;
  content: string;
  children: string[];
  relationships: Array<{ type: string; target: string }>;
}

/** A simple Markdown-to-HTML renderer (very minimal — headings, paragraphs, links). */
function renderMarkdown(md: string): string {
  return md
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Headings
      if (line.startsWith('### ')) return `<h3>${esc(line.slice(4))}</h3>`;
      if (line.startsWith('## ')) return `<h2>${esc(line.slice(3))}</h2>`;
      if (line.startsWith('# ')) return `<h1>${esc(line.slice(2))}</h1>`;
      // Links [text](url)
      const linkMatch = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        return `<p>${esc(line).replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          '<a href="$2" data-link="$2">$1</a>',
        )}</p>`;
      }
      return `<p>${esc(line)}</p>`;
    })
    .join('');
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A document tablet. Renders the document's content as continuous Markdown.
 * The `depth` property controls its 3D position in the stack (0 = front/active).
 */
@customElement('document-tablet')
export class DocumentTablet extends LitElement {
  @property({ type: Object }) document!: DocumentData;
  @property({ type: Array }) blocks: BlockData[] = [];
  @property({ type: Number }) depth = 0;
  @property({ type: String }) focusedBlock: string | null = null;
  @property({ type: Boolean }) attentionBlock: string | null = null;

  static override styles = css`
    :host {
      display: block;
      transition: transform 0.4s ease;
    }

    .tablet {
      width: 600px;
      min-height: 400px;
      max-height: 70vh;
      overflow-y: auto;
      padding: 32px 40px;
      background: rgba(30, 30, 50, 0.65);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      color: rgba(255, 255, 255, 0.9);
      font-family: Georgia, serif;
      font-size: 16px;
      line-height: 1.7;
    }

    .tablet.focused {
      border-color: rgba(120, 160, 255, 0.4);
      box-shadow:
        0 8px 32px rgba(0, 0, 0, 0.4),
        0 0 24px rgba(120, 160, 255, 0.15);
    }

    .tablet h1 {
      font-size: 28px;
      margin: 0 0 16px;
    }

    .tablet h2 {
      font-size: 22px;
      margin: 24px 0 8px;
      scroll-margin-top: 16px;
    }

    .tablet h3 {
      font-size: 18px;
      margin: 20px 0 8px;
      scroll-margin-top: 16px;
    }

    .tablet p {
      margin: 8px 0;
    }

    .tablet a[data-link] {
      color: rgba(120, 160, 255, 0.9);
      cursor: pointer;
      text-decoration: underline;
    }

    .block {
      scroll-margin-top: 16px;
      transition: background 0.3s;
    }

    .block.attention {
      background: rgba(120, 160, 255, 0.12);
      border-radius: 8px;
      animation: fadeAttention 2s ease forwards;
    }

    @keyframes fadeAttention {
      0% {
        background: rgba(120, 160, 255, 0.25);
      }
      100% {
        background: transparent;
      }
    }

    .close-btn {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(0, 0, 0, 0.3);
      color: rgba(255, 255, 255, 0.5);
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
    }
  `;

  override render() {
    const transform =
      this.depth === 0
        ? 'translateZ(0) rotateY(0deg)'
        : `translateZ(${-this.depth * 80}px) rotateY(${this.depth * 8}deg) translateX(${this.depth * 20}px)`;
    const opacity = this.depth === 0 ? 1 : Math.max(0.3, 1 - this.depth * 0.25);
    return html`
      <div
        class="tablet${this.depth === 0 ? ' focused' : ''}"
        style="transform: ${transform}; opacity: ${opacity};"
      >
        <button
          class="close-btn"
          @click=${() => this.dispatchEvent(new CustomEvent('close', { detail: this.document.id }))}
        >
          ×
        </button>
        <h1>${this.document.title}</h1>
        ${this.blocks.map((block) => this.renderBlock(block))}
      </div>
    `;
  }

  private renderBlock(block: BlockData) {
    const hasAttention = this.attentionBlock === block.id;
    return html`
      <div
        class="block${hasAttention ? ' attention' : ''}"
        data-block-id=${block.id}
        id=${block.id}
        @click=${(e: Event) => {
          e.stopPropagation();
          this.dispatchEvent(
            new CustomEvent('attention', {
              detail: { document: this.document.id, block: block.id },
            }),
          );
        }}
      >
        ${block.title ? html`<h2>${block.title}</h2>` : nothing}
        <div .innerHTML=${renderMarkdown(block.content)} @click=${this.handleLinkClick}></div>
      </div>
    `;
  }

  private handleLinkClick = (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' && target.dataset.link) {
      e.preventDefault();
      this.dispatchEvent(new CustomEvent('traverse', { detail: { link: target.dataset.link } }));
    }
  };

  override updated(): void {
    // Scroll the focused block into view.
    if (this.focusedBlock) {
      const el = this.shadowRoot?.getElementById(this.focusedBlock);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'document-tablet': DocumentTablet;
  }
}
