/**
 * The Guide's avatar: a visible figure on the overlay plane, with speech,
 * position, visibility, and animation, as defined by
 * [User interface](../../specs/ui.spec.md#the-guides-avatar).
 *
 * @see specs/ui.spec.md#figure
 * @see specs/ui.spec.md#avatar-position-and-visibility
 * @see specs/ui.spec.md#speech
 */

import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/** The fixed avatar positions. */
export const AVATAR_POSITIONS = ['left', 'center', 'right', 'aside'] as const;
export type AvatarPosition = (typeof AVATAR_POSITIONS)[number];

/**
 * The Guide's avatar. Renders a figure on the overlay plane, with speech text
 * near it. The Visitor can drag the figure; on release it snaps to the nearest
 * fixed position.
 */
@customElement('guide-avatar')
export class GuideAvatar extends LitElement {
  @property({ type: String }) position: AvatarPosition = 'center';
  @property({ type: Boolean }) visible = true;
  @state() private speech: string | null = null;
  @state() private dragging = false;

  private speechTimer: ReturnType<typeof setTimeout> | null = null;

  static override styles = css`
    :host {
      display: block;
      position: absolute;
      transition:
        left 0.3s ease,
        top 0.3s ease,
        opacity 0.3s ease;
      cursor: grab;
      user-select: none;
    }

    :host(.dragging) {
      cursor: grabbing;
      transition: none;
    }

    .figure {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: radial-gradient(
        circle at 35% 30%,
        rgba(120, 160, 255, 0.6),
        rgba(60, 80, 140, 0.4)
      );
      border: 1px solid rgba(255, 255, 255, 0.2);
      box-shadow: 0 0 24px rgba(120, 160, 255, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      color: rgba(255, 255, 255, 0.6);
    }

    .speech {
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      max-width: 300px;
      min-width: 120px;
      padding: 10px 16px;
      margin-bottom: 12px;
      background: rgba(20, 20, 35, 0.85);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      color: rgba(255, 255, 255, 0.9);
      font-family: Georgia, serif;
      font-size: 14px;
      line-height: 1.5;
      text-align: center;
      pointer-events: none;
      animation: fadeIn 0.3s ease;
    }

    .speech::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 6px solid transparent;
      border-top-color: rgba(20, 20, 35, 0.85);
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }

    .hidden {
      opacity: 0;
      pointer-events: none;
    }
  `;

  override render() {
    if (!this.visible) return nothing;
    const posStyles: Record<AvatarPosition, string> = {
      left: 'left: 15%; top: 40%;',
      center: 'left: 50%; top: 30%;',
      right: 'left: 80%; top: 40%;',
      aside: 'left: 90%; top: 60%;',
    };
    return html`
      <div
        style=${posStyles[this.position] ?? posStyles.center}
        class=${this.dragging ? 'dragging' : ''}
        @pointerdown=${this.handlePointerDown}
      >
        ${this.speech ? html`<div class="speech">${this.speech}</div>` : nothing}
        <div class="figure">◈</div>
      </div>
    `;
  }

  /** Show speech text near the avatar. Clears after a timeout. */
  showSpeech(text: string, duration = 8000): void {
    this.speech = text;
    if (this.speechTimer) clearTimeout(this.speechTimer);
    this.speechTimer = setTimeout(() => {
      this.speech = null;
    }, duration);
  }

  /** Reposition the avatar. */
  setPosition(pos: string): void {
    if (AVATAR_POSITIONS.includes(pos as AvatarPosition)) {
      this.position = pos as AvatarPosition;
    }
  }

  /** Show or hide the avatar. */
  setVisibility(visible: boolean): void {
    this.visible = visible;
  }

  /** Drive an animation (placeholder — CSS class-based for now). */
  playAnimation(_animation: string, _params?: Record<string, unknown>): void {
    // Placeholder: could add CSS animation classes based on the animation name.
  }

  private handlePointerDown = (e: PointerEvent) => {
    this.dragging = true;
    const el = e.currentTarget as HTMLElement;

    const onMove = (ev: PointerEvent) => {
      el.style.left = `${ev.clientX}px`;
      el.style.top = `${ev.clientY}px`;
    };

    const onUp = (ev: PointerEvent) => {
      this.dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // Snap to the nearest fixed position.
      const snapped = this.snapToNearest(ev.clientX, ev.clientY);
      this.setPosition(snapped);
      this.dispatchEvent(new CustomEvent('reposition', { detail: { position: snapped } }));
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  private snapToNearest(x: number, _y: number): string {
    // Simple snapping: pick the position based on horizontal screen position.
    const w = window.innerWidth;
    if (x < w * 0.25) return 'left';
    if (x < w * 0.6) return 'center';
    if (x < w * 0.85) return 'right';
    return 'aside';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'guide-avatar': GuideAvatar;
  }
}
