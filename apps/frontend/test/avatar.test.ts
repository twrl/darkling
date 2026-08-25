/**
 * Tests for the sprite avatar's pure frame-resolution logic, which implements
 * the verified clippyjs `Animator` semantics: linear non-looping advancement,
 * weighted-random branching on a 0..100 scale with fall-through to `+1`, and
 * `exitBranch` jumps gated on an `exiting` flag.
 *
 * The canvas-driven {@link SpriteAvatar} itself is not DOM-tested, following
 * the repo convention (no DOM test environment configured); the normative
 * animation behaviour lives in {@link resolveNextFrameIndex} / {@link pickBranch}
 * and is covered here.
 *
 * @see apps/frontend/src/ui/avatar/sprite-avatar.ts
 */

import { describe, expect, it } from 'vitest';

import {
  resolveNextFrameIndex,
  pickBranch,
  dataUrlToBlob,
  DEFAULT_FRAME_DURATION,
  DEFAULT_BRANCH_WEIGHT,
} from '../src/ui/avatar/sprite-avatar.js';
import type { FrameDef } from '../src/ui/avatar/agent-types.js';

function frame(images: [number, number][] = [[0, 0]], extra: Partial<FrameDef> = {}): FrameDef {
  return { duration: 100, images, ...extra };
}

describe('resolveNextFrameIndex — linear playback', () => {
  it('advances index by 1', () => {
    const f = frame();
    expect(resolveNextFrameIndex(0, f, false)).toBe(1);
    expect(resolveNextFrameIndex(3, f, false)).toBe(4);
  });

  it('does NOT loop — returns index+1 even past the last frame (caller clamps)', () => {
    const f = frame();
    // No wrap-to-0; the SpriteAvatar clamps to frames.length-1.
    expect(resolveNextFrameIndex(5, f, false)).toBe(6);
  });
});

describe('resolveNextFrameIndex — branching', () => {
  it('uses a weighted-random branch target on a 0..100 scale', () => {
    const branchingFrame: FrameDef = frame(undefined, {
      branching: {
        branches: [
          { frameIndex: 5, weight: 30 },
          { frameIndex: 9, weight: 70 },
        ],
      },
    });
    // pickBranch draws rng()*100 with a `<=` weight comparison.
    // rng in [0, 0.30] → roll <= 30 → first (5); rng in (0.30, 1) → second (9).
    expect(resolveNextFrameIndex(0, branchingFrame, false, () => 0.0)).toBe(5);
    expect(resolveNextFrameIndex(0, branchingFrame, false, () => 0.3)).toBe(5);
    expect(resolveNextFrameIndex(0, branchingFrame, false, () => 0.31)).toBe(9);
    expect(resolveNextFrameIndex(0, branchingFrame, false, () => 0.999)).toBe(9);
  });

  it('falls through to index+1 when no branch weight is reached', () => {
    // Two branches with total weight 50; roll >= 50 falls through.
    const branchingFrame: FrameDef = frame(undefined, {
      branching: {
        branches: [
          { frameIndex: 7, weight: 25 },
          { frameIndex: 11, weight: 25 },
        ],
      },
    });
    // `<=` comparison: roll 25 catches the first branch (weight 25).
    expect(resolveNextFrameIndex(2, branchingFrame, false, () => 0.0)).toBe(7);
    expect(resolveNextFrameIndex(2, branchingFrame, false, () => 0.25)).toBe(7);
    expect(resolveNextFrameIndex(2, branchingFrame, false, () => 0.26)).toBe(11);
    expect(resolveNextFrameIndex(2, branchingFrame, false, () => 0.49)).toBe(11);
    // rng 0.50 → roll 50; second weight 25 → 50-25=25 <= 25 → still matches (11).
    expect(resolveNextFrameIndex(2, branchingFrame, false, () => 0.5)).toBe(11);
    // rng 0.51+ → roll > 50 (total weight) → no branch matches → fall through.
    expect(resolveNextFrameIndex(2, branchingFrame, false, () => 0.51)).toBe(3);
    expect(resolveNextFrameIndex(2, branchingFrame, false, () => 0.99)).toBe(3);
  });
});

describe('resolveNextFrameIndex — exit branching', () => {
  it('jumps to exitBranch when exiting is true', () => {
    const f = frame(undefined, { exitBranch: 17 });
    expect(resolveNextFrameIndex(0, f, true)).toBe(17);
    expect(resolveNextFrameIndex(5, f, true)).toBe(17);
  });

  it('ignores exitBranch when exiting is false', () => {
    const f = frame(undefined, { exitBranch: 17 });
    expect(resolveNextFrameIndex(0, f, false)).toBe(1);
  });

  it('exitBranch takes precedence over branching when exiting', () => {
    const f = frame(undefined, {
      exitBranch: 42,
      branching: { branches: [{ frameIndex: 99, weight: 100 }] },
    });
    expect(resolveNextFrameIndex(0, f, true, () => 0)).toBe(42);
  });
});

describe('pickBranch', () => {
  it('returns undefined for an empty branch list (falls through)', () => {
    expect(pickBranch([])).toBeUndefined();
  });

  it('applies a default weight of 1 to unweighted branches', () => {
    // rng 0 → roll 0 <= default weight 1 → first branch.
    expect(pickBranch([{ frameIndex: 7 }], () => 0)).toBe(7);
    // rng 5 → roll 5; default weights 1+1=2 total; 5 > 2 → falls through.
    expect(pickBranch([{ frameIndex: 7 }, { frameIndex: 11 }], () => 5)).toBeUndefined();
  });
});

describe('dataUrlToBlob', () => {
  it('decodes a base64 data URL to a Blob of the given MIME type', async () => {
    // "Hello" base64.
    const blob = dataUrlToBlob('data:text/plain;base64,SGVsbG8=');
    expect(blob.type).toBe('text/plain');
    expect(await blob.text()).toBe('Hello');
  });

  it('decodes a non-base64 (URL-encoded) data URL', async () => {
    const blob = dataUrlToBlob('data:text/plain,Hi%20there');
    expect(blob.type).toBe('text/plain');
    expect(await blob.text()).toBe('Hi there');
  });

  it('defaults the MIME type when omitted', async () => {
    const blob = dataUrlToBlob('data:;base64,SGVsbG8=');
    expect(blob.type).toBe('application/octet-stream');
    expect(await blob.text()).toBe('Hello');
  });

  it('rejects an invalid data URL', () => {
    expect(() => dataUrlToBlob('not-a-data-url')).toThrow('Invalid data URL');
  });

  it('round-trips a PNG signature through a base64 data URL', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const b64 = 'data:image/png;base64,' + btoa(String.fromCharCode(...png));
    const blob = dataUrlToBlob(b64);
    expect(blob.type).toBe('image/png');
    const out = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(out)).toEqual(Array.from(png));
  });
});

describe('constants', () => {
  it('exposes the documented defaults', () => {
    expect(DEFAULT_FRAME_DURATION).toBe(100);
    expect(DEFAULT_BRANCH_WEIGHT).toBe(1);
  });
});
