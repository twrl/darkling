/**
 * The UI-control tools: `navigate` and `draw_attention`, as defined by
 * [User interface](../../specs/ui.spec.md#ui-control-tools).
 *
 * These are registered in the `ui-control` category. The `navigate` tool
 * proposes an `interface` slice update with `source: "guide"`, subject to the
 * User-precedence check at dispatch time (inspecting the stack's `openedBy`).
 * The `draw_attention` tool dispatches a transient highlight directly.
 *
 * @see specs/ui.spec.md#ui-control-tools
 */

import { z } from 'zod';
import type { ToolDeclaration, ToolHandler, ToolDispatchContext } from '@darkling/guide';
import type { LocalCopy } from '@darkling/state-manager';

/** The context the UI-control tools need: the interface-slice local copy + the attention effect dispatch. */
export interface UiControlContext {
  /** The local copy of the `interface` slice. */
  localCopy: LocalCopy;
  /** The bus service client for proposing interface-slice updates. */
  proposeUpdate: (proposal: {
    slice: string;
    patch: unknown[];
    basisSeq: number;
    source: 'guide';
  }) => Promise<{ seq: number }>;
  /** Dispatch a transient Draw-attention highlight on a block. */
  drawAttention: (document: string, block: string) => Promise<void>;
}

/** The `navigate` tool parameters. */
const navigateParams = z.object({
  document: z.string(),
  block: z.string().optional(),
});

/** The `draw_attention` tool parameters. */
const drawAttentionParams = z.object({
  document: z.string(),
  block: z.string(),
});

/** The interface slice stack entry shape (for the User-precedence check). */
interface StackEntry {
  document: string;
  openedBy: 'ui' | 'guide' | 'service';
}

/** The interface slice value shape. */
interface InterfaceSlice {
  stack: StackEntry[];
  activeDocument: string | null;
  focus: { document: string; block: string } | null;
}

/**
 * Create the `navigate` tool declaration and handler.
 *
 * Dispatch enforces User precedence by inspecting the current stack: if the
 * active document's tablet has `openedBy: "ui"` and the call would change
 * `activeDocument` away from it, the call is rejected.
 */
export function createNavigateTool(ctx: UiControlContext): {
  declaration: ToolDeclaration;
  handler: ToolHandler;
} {
  return {
    declaration: {
      name: 'navigate',
      category: 'ui-control',
      params: navigateParams,
      returns: z.object({ ok: z.boolean() }),
      cost: 1,
      description:
        'Navigate the interface to present a specific document or content block. ' +
        'Subject to User precedence: if the Visitor opened the current active document, ' +
        'the Guide cannot navigate away from it.',
    },
    handler: async (params, _context: ToolDispatchContext) => {
      const { document: targetDoc, block: targetBlock } = navigateParams.parse(params);
      const state = ctx.localCopy.get('interface') as InterfaceSlice | undefined;
      if (state) {
        const activeEntry = state.stack[0];
        if (activeEntry && activeEntry.openedBy === 'ui' && activeEntry.document !== targetDoc) {
          // User precedence: the Visitor opened the active document.
          return {
            ok: false,
            error: `Cannot navigate away from document "${activeEntry.document}" — the Visitor opened it.`,
          };
        }
      }
      // Propose the interface-slice update.
      const basisSeq = ctx.localCopy.signal('interface').get() as unknown as number;
      // Compute the patch: push/bring forward the target document and focus the block.
      // For the initial implementation, the patch is a full replacement of the
      // interface slice value. A real implementation would compute a minimal Immer
      // patch via `computePatch`.
      const currentState = (ctx.localCopy.get('interface') as InterfaceSlice | undefined) ?? {
        stack: [],
        activeDocument: null,
        focus: null,
      };
      const newStack = [
        { document: targetDoc, openedBy: 'guide' as const },
        ...currentState.stack.filter((e) => e.document !== targetDoc),
      ];
      const newValue: InterfaceSlice = {
        stack: newStack,
        activeDocument: targetDoc,
        focus: targetBlock ? { document: targetDoc, block: targetBlock } : null,
      };
      // Simple replace patch.
      const patch = [{ op: 'replace' as const, path: [], value: newValue }];
      await ctx.proposeUpdate({
        slice: 'interface',
        patch,
        basisSeq: basisSeq ?? 0,
        source: 'guide',
      });
      return { ok: true };
    },
  };
}

/**
 * Create the `draw_attention` tool declaration and handler.
 *
 * Dispatches a transient highlight on a block within the active document. Fails
 * if the document is not the active document.
 */
export function createDrawAttentionTool(ctx: UiControlContext): {
  declaration: ToolDeclaration;
  handler: ToolHandler;
} {
  return {
    declaration: {
      name: 'draw_attention',
      category: 'ui-control',
      params: drawAttentionParams,
      returns: z.object({ ok: z.boolean() }),
      cost: 1,
      description:
        "Draw the Visitor's attention to a block within the active document. " +
        'The document must be the active document; otherwise the call fails.',
    },
    handler: async (params, _context: ToolDispatchContext) => {
      const { document, block } = drawAttentionParams.parse(params);
      const state = ctx.localCopy.get('interface') as InterfaceSlice | undefined;
      if (!state || state.activeDocument !== document) {
        return {
          ok: false,
          error: `Document "${document}" is not the active document. Navigate to it first.`,
        };
      }
      await ctx.drawAttention(document, block);
      return { ok: true };
    },
  };
}

/** All UI-control tool declarations + handlers. */
export function createUiControlTools(ctx: UiControlContext): Array<{
  declaration: ToolDeclaration;
  handler: ToolHandler;
}> {
  return [createNavigateTool(ctx), createDrawAttentionTool(ctx)];
}
