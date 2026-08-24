/**
 * The avatar-interaction tools: `speak`, `set_avatar_position`,
 * `set_avatar_visibility`, and `animate_avatar`, as defined by
 * [User interface](../../specs/ui.spec.md#avatar-interaction-tools).
 *
 * These are registered in the `avatar-and-user-interaction` category. They
 * affect the avatar's own presentation only, not the Archive interface.
 *
 * @see specs/ui.spec.md#avatar-interaction-tools
 */

import { z } from 'zod';
import type { ToolDeclaration, ToolHandler, ToolDispatchContext } from '@darkling/guide';

/** The context the avatar tools need: avatar state + effect dispatch. */
export interface AvatarToolContext {
  /** The avatar's current visibility state. */
  isAvatarVisible: () => boolean;
  /** Render speech near the avatar. */
  speak: (text: string) => Promise<void>;
  /** Reposition the avatar to a named fixed position. */
  setPosition: (position: string) => Promise<void>;
  /** Show or hide the avatar. */
  setVisibility: (visible: boolean) => Promise<void>;
  /** Drive an animation on the avatar. */
  animate: (animation: string, params?: Record<string, unknown>) => Promise<void>;
}

const speakParams = z.object({ text: z.string() });
const setPositionParams = z.object({ position: z.string() });
const setVisibilityParams = z.object({ visible: z.boolean() });
const animateParams = z.object({
  animation: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

/** Create the `speak` tool. */
export function createSpeakTool(ctx: AvatarToolContext): {
  declaration: ToolDeclaration;
  handler: ToolHandler;
} {
  return {
    declaration: {
      name: 'speak',
      category: 'avatar-and-user-interaction',
      params: speakParams,
      returns: z.object({ ok: z.boolean() }),
      cost: 1,
      description: 'Address the Visitor with speech, rendered near the avatar.',
    },
    handler: async (params, _context: ToolDispatchContext) => {
      const { text } = speakParams.parse(params);
      if (!ctx.isAvatarVisible()) {
        return { ok: false, error: 'The avatar is hidden; a hidden Guide cannot speak.' };
      }
      await ctx.speak(text);
      return { ok: true };
    },
  };
}

/** Create the `set_avatar_position` tool. */
export function createSetAvatarPositionTool(ctx: AvatarToolContext): {
  declaration: ToolDeclaration;
  handler: ToolHandler;
} {
  return {
    declaration: {
      name: 'set_avatar_position',
      category: 'avatar-and-user-interaction',
      params: setPositionParams,
      returns: z.object({ ok: z.boolean() }),
      cost: 0,
      description: 'Reposition the avatar to a named fixed position.',
    },
    handler: async (params, _context: ToolDispatchContext) => {
      const { position } = setPositionParams.parse(params);
      await ctx.setPosition(position);
      return { ok: true };
    },
  };
}

/** Create the `set_avatar_visibility` tool. */
export function createSetAvatarVisibilityTool(ctx: AvatarToolContext): {
  declaration: ToolDeclaration;
  handler: ToolHandler;
} {
  return {
    declaration: {
      name: 'set_avatar_visibility',
      category: 'avatar-and-user-interaction',
      params: setVisibilityParams,
      returns: z.object({ ok: z.boolean() }),
      cost: 0,
      description: 'Show or hide the avatar. A hidden Guide cannot speak.',
    },
    handler: async (params, _context: ToolDispatchContext) => {
      const { visible } = setVisibilityParams.parse(params);
      await ctx.setVisibility(visible);
      return { ok: true };
    },
  };
}

/** Create the `animate_avatar` tool. */
export function createAnimateAvatarTool(ctx: AvatarToolContext): {
  declaration: ToolDeclaration;
  handler: ToolHandler;
} {
  return {
    declaration: {
      name: 'animate_avatar',
      category: 'avatar-and-user-interaction',
      params: animateParams,
      returns: z.object({ ok: z.boolean() }),
      cost: 0,
      description: 'Drive an animation on the avatar (gesture, motion, or transition).',
    },
    handler: async (params, _context: ToolDispatchContext) => {
      const { animation, params: animParams } = animateParams.parse(params);
      await ctx.animate(animation, animParams);
      return { ok: true };
    },
  };
}

/** All avatar-interaction tool declarations + handlers. */
export function createAvatarTools(ctx: AvatarToolContext): Array<{
  declaration: ToolDeclaration;
  handler: ToolHandler;
}> {
  return [
    createSpeakTool(ctx),
    createSetAvatarPositionTool(ctx),
    createSetAvatarVisibilityTool(ctx),
    createAnimateAvatarTool(ctx),
  ];
}
