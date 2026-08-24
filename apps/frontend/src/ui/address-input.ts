/**
 * The address input: the Visitor composes and submits a direct address to the
 * Guide, producing a `direct_address` event, as defined by
 * [User interface](../../specs/ui.spec.md#addressing-the-guide).
 *
 * @see specs/ui.spec.md#addressing-the-guide
 */

import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';

/**
 * The address input. Part of the UI chrome, not the tablets. Submitting
 * produces a `direct_address` event (which always flushes the event queue,
 * per event-system.spec.md).
 */
@customElement('address-input')
export class AddressInput extends LitElement {
  @state() private value = '';

  static override styles = css`
    :host {
      display: block;
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      width: min(600px, 80vw);
      z-index: 200;
    }

    form {
      display: flex;
      gap: 8px;
    }

    input {
      flex: 1;
      padding: 12px 16px;
      border-radius: 24px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(20, 20, 35, 0.7);
      backdrop-filter: blur(8px);
      color: rgba(255, 255, 255, 0.9);
      font-family: Georgia, serif;
      font-size: 14px;
      box-sizing: border-box;
    }

    input::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }

    button {
      padding: 10px 20px;
      border-radius: 24px;
      border: 1px solid rgba(120, 160, 255, 0.3);
      background: rgba(60, 80, 140, 0.3);
      color: rgba(255, 255, 255, 0.9);
      cursor: pointer;
      font-size: 14px;
      font-family: Georgia, serif;
      transition: background 0.2s;
    }

    button:hover {
      background: rgba(80, 100, 160, 0.4);
    }
  `;

  override render() {
    return html`
      <form @submit=${this.handleSubmit}>
        <input
          type="text"
          placeholder="Address the Guide..."
          .value=${this.value}
          @input=${(e: Event) => (this.value = (e.target as HTMLInputElement).value)}
        />
        <button type="submit">Send</button>
      </form>
    `;
  }

  private handleSubmit = (e: Event) => {
    e.preventDefault();
    const text = this.value.trim();
    if (!text) return;
    this.dispatchEvent(new CustomEvent('address', { detail: text }));
    this.value = '';
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'address-input': AddressInput;
  }
}
