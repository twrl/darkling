/**
 * A clippyjs-style sprite animator that renders the Guide's avatar figure onto
 * a `<canvas>`.
 *
 * Loads an agent config (JSON) and sprite sheet (PNG), then drives
 * frame-by-frame animation on the main thread. Each frame composites one or
 * more sprite cells (one per overlay layer, in order). Frame advancement
 * follows the clippyjs `Animator` semantics:
 *
 * - The next frame is `index + 1` by default; animations do **not** loop —
 *   they park at the last frame and stay there (clamped).
 * - A frame with `branching` performs a weighted-random choice over its
 *   branches (weights on a 0..100 scale); if no branch weight is reached,
 *   advancement falls through to `index + 1`.
 * - When an exit has been requested via {@link SpriteAvatar.exitAnimation}, a
 *   frame with an `exitBranch` jumps to that index, driving an exit sequence.
 * - An animation with `useExitBranching` freezes on its last frame (the frame
 *   image is not advanced further) and is intended to be exited via
 *   `exitAnimation()` rather than running to completion.
 *
 * @see specs/ui.spec.md#figure
 * @see specs/ui.spec.md#avatar-animation
 */

import type { AgentConfig, AnimationDef, BranchDef, FrameDef, LoadedAgent } from './agent-types.js';

/** Default frame duration (ms) when a frame omits `duration`. */
export const DEFAULT_FRAME_DURATION = 100;

/** Default branch weight when a branch omits `weight` (clippyjs uses 0..100). */
export const DEFAULT_BRANCH_WEIGHT = 1;

/**
 * Resolve the next frame index for a frame, applying clippyjs `Animator`
 * semantics:
 *
 * 1. If `exiting` is set and the frame defines `exitBranch`, jump to it
 *    (drives an exit sequence after `exitAnimation()` is requested).
 * 2. Else if the frame has `branching`, draw a random number in `[0, 100)`
 *    and walk the branches subtracting each `weight`; the first branch whose
 *    weight is reached wins. If **no** branch is reached, fall through to
 *    `index + 1` (branching is probabilistic, not guaranteed).
 * 3. Else advance to `index + 1`. Animations do not loop; callers should clamp
 *    the result to `frames.length - 1`.
 *
 * `useExitBranching` is honoured by the caller (it freezes the frame image at
 * the last frame rather than advancing); it is not a branch-gate here.
 */
export function resolveNextFrameIndex(
  index: number,
  frame: FrameDef,
  exiting: boolean,
  rng: () => number = Math.random,
): number {
  if (exiting && frame.exitBranch !== undefined) {
    return frame.exitBranch;
  }
  if (frame.branching) {
    const branch = pickBranch(frame.branching.branches, rng);
    if (branch !== undefined) return branch;
  }
  return index + 1;
}

/**
 * Weighted-random selection of a branch target on a 0..100 scale, mirroring
 * clippyjs. Returns `undefined` when no branch weight is reached (fall-through
 * to linear advancement). Returns `undefined` for an empty branch list.
 */
export function pickBranch(
  branches: BranchDef[],
  rng: () => number = Math.random,
): number | undefined {
  if (branches.length === 0) return undefined;
  let roll = rng() * 100;
  for (const branch of branches) {
    const weight = branch.weight ?? DEFAULT_BRANCH_WEIGHT;
    if (roll <= weight) return branch.frameIndex;
    roll -= weight;
  }
  // No branch matched → fall through to linear advancement.
  return undefined;
}

/** Default idle frame, used when no `idle` animation is defined. */
const DEFAULT_IDLE_FRAME: FrameDef = { images: [[0, 0]] };

/** Resolve the idle frame for a config (the first frame of its `idle` animation, else a default). */
function idleFrameFor(config: AgentConfig): FrameDef {
  return config.animations.idle?.frames[0] ?? DEFAULT_IDLE_FRAME;
}

/** Loads an agent's config + sprite from URLs. */
export async function loadAgent(agentUrl: string, spriteUrl: string): Promise<LoadedAgent> {
  const [configRes, spriteRes] = await Promise.all([fetch(agentUrl), fetch(spriteUrl)]);
  if (!configRes.ok) {
    throw new Error(`Failed to load agent config: ${configRes.status}`);
  }
  if (!spriteRes.ok) {
    throw new Error(`Failed to load sprite sheet: ${spriteRes.status}`);
  }

  const wrapper = (await configRes.json()) as { config?: AgentConfig } | AgentConfig;
  const config = (wrapper as { config?: AgentConfig }).config ?? (wrapper as AgentConfig);

  const blob = await spriteRes.blob();
  const sprite: HTMLImageElement | ImageBitmap =
    typeof createImageBitmap === 'function'
      ? await createImageBitmap(blob)
      : await blobToImage(blob);

  return { config, sprite };
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode sprite sheet image'));
    };
    img.src = url;
  });
}

/**
 * Decode a `data:` URL (e.g. a base64 PNG) into a `Blob`. Used to turn the
 * clippyjs sprite data URL into an image source without a network fetch.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match || match[3] === undefined) throw new Error('Invalid data URL');
  const mime = match[1] || 'application/octet-stream';
  const isBase64 = match[2] === ';base64';
  const data = match[3];
  const bytes = isBase64
    ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(data));
  return new Blob([bytes], { type: mime });
}

/**
 * Load Clippy itself (the canonical Microsoft Agent sprite + animation data)
 * from the `clippyjs` package, as the Guide's default avatar.
 *
 * The clippyjs agent modules export the config as a JS object and the sprite
 * sheet as a base64 PNG `data:` URL; this decodes the data URL into an
 * `ImageBitmap` (or `HTMLImageElement` fallback) and returns a
 * {@link LoadedAgent}.
 *
 * The clippyjs package types its agent data loosely (e.g. `framesize` as
 * `number[]` rather than a tuple), so the module is cast through `unknown` to
 * our stricter {@link AgentConfig}.
 */
export async function loadClippyAgent(): Promise<LoadedAgent> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clippy = (await import('clippyjs/agents/clippy')) as any;
  const loaders: ClippyLoaders = clippy.default ?? clippy;
  const [agentMod, mapMod] = await Promise.all([loaders.agent(), loaders.map()]);
  const config = agentMod.default as AgentConfig;
  const spriteDataUrl = mapMod.default as string;
  const blob = dataUrlToBlob(spriteDataUrl);
  const sprite: HTMLImageElement | ImageBitmap =
    typeof createImageBitmap === 'function'
      ? await createImageBitmap(blob)
      : await blobToImage(blob);
  return { config, sprite };
}

/** The clippyjs agent loader shape (`{ agent, sound, map }`). */
interface ClippyLoaders {
  agent: () => Promise<{ default: AgentConfig }>;
  sound: () => Promise<{ default: Record<string, string> }>;
  map: () => Promise<{ default: string }>;
}

/**
 * The sprite avatar renderer. Owns a canvas context, the loaded agent, and
 * the current animation state. Call {@link play} to start a named animation,
 * {@link stop} to return to idle.
 */
export class SpriteAvatar {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly rng: () => number;

  private agent: LoadedAgent | null = null;
  private currentAnimation: AnimationDef | null = null;
  private currentFrameIndex = 0;
  private exiting = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(canvas: HTMLCanvasElement, rng: () => number = Math.random) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire 2D context for avatar canvas');
    this.ctx = ctx;
    this.rng = rng;
  }

  /** Whether an agent config + sprite are loaded and ready to render. */
  get ready(): boolean {
    return this.agent !== null;
  }

  /** Load (or replace) the agent config + sprite. Renders the idle frame. */
  async load(agent: LoadedAgent): Promise<void> {
    this.stop();
    this.agent = agent;
    const [w, h] = agent.config.framesize;
    this.canvas.width = w;
    this.canvas.height = h;
    this.drawFrame(idleFrameFor(agent.config));
  }

  /**
   * Play a named animation. If the animation is unknown, this is a no-op.
   * Interrupts any running animation (clearing any pending exit).
   */
  play(name: string): void {
    const agent = this.agent;
    if (!agent) return;
    const anim = agent.config.animations[name];
    if (!anim) return;
    this.stopAnimation();
    this.currentAnimation = anim;
    this.currentFrameIndex = 0;
    this.exiting = false;
    this.stepFrame();
  }

  /**
   * Request that the current animation exit at the next frame that defines an
   * `exitBranch`. Mirrors clippyjs `Animator.exitAnimation()`: the next frame
   * carrying an `exitBranch` jumps to it, driving the animation's exit
   * sequence. No-op if no animation is running.
   */
  exitAnimation(): void {
    this.exiting = true;
  }

  /** Stop any running animation and clear to the idle frame (frame 0). */
  stop(): void {
    this.stopAnimation();
    this.currentAnimation = null;
    this.currentFrameIndex = 0;
    this.exiting = false;
    const agent = this.agent;
    if (agent) this.drawFrame(idleFrameFor(agent.config));
  }

  private stopAnimation(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Advance one frame of the current animation and schedule the next. */
  private stepFrame(): void {
    const anim = this.currentAnimation;
    const agent = this.agent;
    if (!anim || !agent) return;

    const frames = anim.frames;
    if (frames.length === 0) {
      this.currentAnimation = null;
      return;
    }

    // Clamp the index defensively (branch/exit targets may be out of range).
    const index = Math.min(this.currentFrameIndex, frames.length - 1);
    const frame = frames[index];
    if (!frame) {
      this.currentAnimation = null;
      return;
    }

    // useExitBranching animations freeze on their last frame (the image is not
    // advanced further); they exit via exitAnimation() rather than running on.
    const atLastFrame = index >= frames.length - 1;
    const frozen = atLastFrame && anim.useExitBranching === true && !this.exiting;

    if (!frozen) {
      this.drawFrame(frame);
    }
    // Keep showing the frozen last-frame image while waiting for an exit.

    const nextRaw = resolveNextFrameIndex(index, frame, this.exiting, this.rng);
    const nextIndex = Math.min(nextRaw, frames.length - 1);
    const duration = frame.duration ?? DEFAULT_FRAME_DURATION;

    this.currentFrameIndex = nextIndex;
    this.timer = setTimeout(() => this.stepFrame(), duration);
  }

  /** Composite a frame's sprite cells onto the canvas. */
  private drawFrame(frame: FrameDef): void {
    const agent = this.agent;
    if (!agent) return;
    const [w, h] = agent.config.framesize;
    this.ctx.clearRect(0, 0, w, h);
    if (!frame.images) return;
    for (const [sx, sy] of frame.images) {
      this.ctx.drawImage(agent.sprite, sx, sy, w, h, 0, 0, w, h);
    }
  }
}
