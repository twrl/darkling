/**
 * Types mirroring the clippyjs agent data format, used to drive the Guide
 * avatar's sprite animation.
 *
 * @see specs/ui.spec.md#the-guides-avatar
 */

export interface AgentConfig {
  overlayCount: number;
  framesize: [number, number];
  sounds: string[];
  animations: Record<string, AnimationDef>;
}

export interface AnimationDef {
  frames: FrameDef[];
  useExitBranching?: boolean;
}

export interface FrameDef {
  duration?: number;
  images?: [number, number][];
  sound?: string;
  exitBranch?: number;
  branching?: {
    branches: BranchDef[];
  };
}

export interface BranchDef {
  frameIndex: number;
  weight?: number;
}

/** The loaded sprite + its config, ready to drive an animation. */
export interface LoadedAgent {
  config: AgentConfig;
  sprite: HTMLImageElement | ImageBitmap;
}
