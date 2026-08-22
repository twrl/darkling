/**
 * Tests for {@link createLocalCopy}: initialisation, patch application,
 * ordering, gap recovery, and reactivity.
 *
 * @see specs/state-manager.spec.md#local-copies
 * @see specs/state-manager.spec.md#initialisation
 * @see specs/state-manager.spec.md#gap-recovery
 * @see specs/state-manager.spec.md#reactivity
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { Signal } from 'signal-polyfill';

import { createLocalCopy, type SnapshotFetcher } from '../src/local-copy.js';
import { createPatchChannel } from '../src/broadcast.js';

import { InMemoryBroadcastChannel, inMemoryChannelFactory } from './fixtures.js';

beforeEach(() => InMemoryBroadcastChannel.reset());

function makeChannel(name: string) {
  return createPatchChannel({ channelName: name, createChannel: inMemoryChannelFactory });
}

function makeFetcher(snapshots: Map<string, { value: unknown; seq: number }>): SnapshotFetcher {
  return {
    async getSnapshot(slice) {
      const s = snapshots.get(slice);
      if (!s) throw new Error(`Unknown slice: ${slice}`);
      return s;
    },
  };
}

describe('LocalCopy', () => {
  describe('initialisation', () => {
    it('fetches the authoritative snapshot on boot before applying patches', async () => {
      const channel = makeChannel('lc-init');
      const snapshots = new Map([['session', { value: { count: 7 }, seq: 5 }]]);
      const fetcher = makeFetcher(snapshots);
      const local = createLocalCopy({
        slices: ['session'],
        channel,
        fetcher,
      });

      await local.init();
      expect(local.get('session')).toEqual({ count: 7 });
    });

    it('does not apply a patch until the initial snapshot resolves', async () => {
      const channel = makeChannel('lc-buffer');
      const snapshots = new Map([['session', { value: { count: 0 }, seq: 0 }]]);
      const fetcher = makeFetcher(snapshots);
      const local = createLocalCopy({
        slices: ['session'],
        channel,
        fetcher,
      });

      // Start init but don't await yet.
      const initP = local.init();
      // Post a patch during init; it must be buffered, not applied to undefined.
      channel.post({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 1 }],
        seq: 1,
      });
      await initP;

      // After init resolves, the buffered patch is applied.
      expect(local.get('session')).toEqual({ count: 1 });
    });
  });

  describe('ordering and delivery', () => {
    it('applies patches in sequence order', async () => {
      const channel = makeChannel('lc-order');
      const snapshots = new Map([['session', { value: { count: 0 }, seq: 0 }]]);
      const fetcher = makeFetcher(snapshots);
      const local = createLocalCopy({
        slices: ['session'],
        channel,
        fetcher,
      });
      await local.init();

      channel.post({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 1 }],
        seq: 1,
      });
      channel.post({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 2 }],
        seq: 2,
      });

      // Allow microtasks to flush.
      await Promise.resolve();
      await Promise.resolve();
      expect(local.get('session')).toEqual({ count: 2 });
    });

    it('ignores duplicate and stale sequence numbers', async () => {
      const channel = makeChannel('lc-dupes');
      const snapshots = new Map([['session', { value: { count: 0 }, seq: 0 }]]);
      const fetcher = makeFetcher(snapshots);
      const local = createLocalCopy({
        slices: ['session'],
        channel,
        fetcher,
      });
      await local.init();

      channel.post({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 1 }],
        seq: 1,
      });
      await Promise.resolve();
      // duplicate
      channel.post({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 99 }],
        seq: 1,
      });
      // stale
      channel.post({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 99 }],
        seq: 0,
      });
      await Promise.resolve();

      expect(local.get('session')).toEqual({ count: 1 });
    });
  });

  describe('gap recovery', () => {
    it('re-fetches on a sequence gap and resumes from the fresh snapshot', async () => {
      const channel = makeChannel('lc-gap');
      const snapshots = new Map([['session', { value: { count: 0 }, seq: 0 }]]);
      const fetcher = makeFetcher(snapshots);
      const local = createLocalCopy({
        slices: ['session'],
        channel,
        fetcher,
      });
      await local.init();

      // Simulate the authority having advanced to seq 8 while we missed 1..7.
      snapshots.set('session', { value: { count: 8 }, seq: 8 });
      channel.post({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 9 }],
        seq: 9,
      });

      // Allow the re-fetch + resume to complete.
      await flush();
      expect(local.get('session')).toEqual({ count: 9 });
    });
  });

  describe('reactivity', () => {
    it('invalidates a Signal.Computed that reads the slice when a patch is applied', async () => {
      const channel = makeChannel('lc-react');
      const snapshots = new Map([['session', { value: { count: 0 }, seq: 0 }]]);
      const fetcher = makeFetcher(snapshots);
      const local = createLocalCopy({
        slices: ['session'],
        channel,
        fetcher,
      });
      await local.init();

      const computed = new Signal.Computed(() => (local.get('session') as { count: number }).count);
      expect(computed.get()).toBe(0);

      channel.post({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 42 }],
        seq: 1,
      });
      await flush();

      expect(computed.get()).toBe(42);
    });
  });

  describe('dispose', () => {
    it('stops receiving patches after dispose', async () => {
      const channel = makeChannel('lc-dispose');
      const snapshots = new Map([['session', { value: { count: 0 }, seq: 0 }]]);
      const fetcher = makeFetcher(snapshots);
      const local = createLocalCopy({
        slices: ['session'],
        channel,
        fetcher,
      });
      await local.init();

      local.dispose();
      channel.post({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 1 }],
        seq: 1,
      });
      await flush();
      expect(local.get('session')).toEqual({ count: 0 });
    });
  });
});

async function flush(): Promise<void> {
  // Allow several microtasks to settle for async re-fetch + apply.
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}
