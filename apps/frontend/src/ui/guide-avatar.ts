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

import { SpriteAvatar, loadAgent, loadClippyAgent } from './avatar/sprite-avatar.js';
import type { LoadedAgent } from './avatar/agent-types.js';

/** The fixed avatar positions. */
export const AVATAR_POSITIONS = ['left', 'center', 'right', 'aside'] as const;
export type AvatarPosition = (typeof AVATAR_POSITIONS)[number];

/**
 * The Guide's avatar. Renders a figure on the overlay plane, with speech text
 * near it. The Visitor can drag the figure; on release it snaps to the nearest
 * fixed position.
 *
 * By default the avatar is Clippy: its sprite sheet and animation data are
 * loaded from the `clippyjs` package. Set `agentUrl` and `spriteUrl` together
 * to load a different agent from URLs instead.
 */
@customElement('guide-avatar')
export class GuideAvatar extends LitElement {
  @property({ type: String }) position: AvatarPosition = 'center';
  @property({ type: Boolean }) visible = true;
  /** Agent config URL. When set with `spriteUrl`, loads that agent instead of Clippy. */
  @property({ type: String }) agentUrl = '';
  /** Sprite sheet URL. When set with `agentUrl`, loads that agent instead of Clippy. */
  @property({ type: String }) spriteUrl = '';

  @state() private speech: string | null = null;
  @state() private dragging = false;

  private speechTimer: ReturnType<typeof setTimeout> | null = null;
  private avatar: SpriteAvatar | null = null;

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
      display: block;
      image-rendering: pixelated;
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
        <canvas class="figure"></canvas>
      </div>
    `;
  }

  override async firstUpdated(): Promise<void> {
    const canvas = this.renderRoot.querySelector('canvas');
    if (!canvas) return;
    this.avatar = new SpriteAvatar(canvas);
    try {
      const agent: LoadedAgent =
        this.agentUrl && this.spriteUrl
          ? await loadAgent(this.agentUrl, this.spriteUrl)
          : await loadClippyAgent();
      await this.avatar.load(agent);
      this.dispatchEvent(new CustomEvent('avatar-ready'));
    } catch (err) {
      console.error('[guide-avatar] load failed:', err);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.avatar?.stop();
    if (this.speechTimer) clearTimeout(this.speechTimer);
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
    if (!visible) this.avatar?.stop();
  }

  /**
   * Drive an animation on the avatar. Named animations come from the agent
   * config's vocabulary (e.g. `gesture_wave`, `blink`, `idle`). The Guide
   * may pass any name the config defines; unknown names are a no-op.
   */
  playAnimation(animation: string, _params?: Record<string, unknown>): void {
    this.avatar?.play(animation);
  }

  /**
   * Request the current animation to exit at the next frame that defines an
   * `exitBranch`, driving its exit sequence. Mirrors clippyjs'
   * `Animator.exitAnimation()`. No-op if no animation is running.
   */
  exitAnimation(): void {
    this.avatar?.exitAnimation();
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
