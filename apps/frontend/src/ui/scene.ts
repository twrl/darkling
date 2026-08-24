/**
 * The 3D scene: a perspective container with a ground plane, a tablet stack,
 * and an overlay plane (avatar + icon rail), as defined by
 * [User interface](../../specs/ui.spec.md#scene).
 *
 * Uses CSS 3D transforms — no WebGL dependency.
 *
 * @see specs/ui.spec.md#scene
 * @see specs/ui.spec.md#reading-surface
 */

import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

/**
 * The 3D scene container. A perspective context in which the ground plane,
 * the tablet stack, and the overlay plane are positioned in 3D space.
 */
@customElement('darkling-scene')
export class DarklingScene extends LitElement {
  static override styles = css`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      perspective: 2000px;
      perspective-origin: 50% 30%;
      background: radial-gradient(ellipse at 50% 80%, #1a1a2e 0%, #0f0f1a 60%, #08080f 100%);
    }

    .scene {
      position: relative;
      width: 100%;
      height: 100%;
      transform-style: preserve-3d;
    }

    .ground-plane {
      position: absolute;
      bottom: 0;
      left: 50%;
      width: 200%;
      height: 200%;
      transform: translateX(-50%) rotateX(90deg);
      transform-origin: bottom center;
      background: linear-gradient(
        135deg,
        rgba(40, 40, 60, 0.4) 0%,
        rgba(20, 20, 35, 0.2) 50%,
        transparent 100%
      );
      pointer-events: none;
    }

    .tablet-stack {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) translateZ(0);
      transform-style: preserve-3d;
    }

    .overlay-plane {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      transform-style: preserve-3d;
      pointer-events: none;
    }

    .overlay-plane > * {
      pointer-events: auto;
    }

    .icon-rail {
      position: absolute;
      top: 12px;
      right: 12px;
      display: flex;
      gap: 8px;
      z-index: 100;
    }

    .icon-rail button {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(20, 20, 35, 0.6);
      backdrop-filter: blur(8px);
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition:
        background 0.2s,
        border-color 0.2s;
    }

    .icon-rail button:hover {
      background: rgba(40, 40, 60, 0.8);
      border-color: rgba(255, 255, 255, 0.3);
    }
  `;

  override render() {
    return html`
      <div class="scene">
        <div class="ground-plane"></div>
        <div class="tablet-stack">
          <slot></slot>
        </div>
        <div class="overlay-plane">
          <slot name="overlay"></slot>
          <div class="icon-rail">
            <slot name="rail"></slot>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'darkling-scene': DarklingScene;
  }
}
