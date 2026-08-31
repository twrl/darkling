import { describe, expect, it, beforeEach } from 'vitest';
import { Signal } from 'signal-polyfill';

import { createLocalCopy, type SnapshotFetcher } from '../src/local-copy.js';
import { createPatchChannel } from '../src/broadcast.js';
import type { RegistryValue } from '../src/registration.js';
import { EMPTY_REGISTRY } from '../src/registration.js';

import { InMemoryBroadcastChannel, inMemoryChannelFactory } from './state-fixtures.js';

beforeEach(() => InMemoryBroadcastChannel.reset());

function makeChannel(name: string) {
  return createPatchChannel({ channelName: name, createChannel: inMemoryChannelFactory });
}

function makeFetcher(
  snapshots: Map<string, { value: unknown; seq: number }>,
  registry: RegistryValue = EMPTY_REGISTRY,
): SnapshotFetcher {
  return {
    async getSnapshot(slice) {
      const s = snapshots.get(slice);
      if (!s) throw new Error(`Unknown slice: ${slice}`);
      return s;
    },
    async getRegistry() {
      return registry;
    },
  };
}

describe('LocalCopy', () => {
  describe('initialisation', () => {
    it('fetches the authoritative snapshot on boot before applying patches', async () => {
      const channel = makeChannel('lc-init');
      const snapshots = new Map([['counter', { value: { count: 7 }, seq: 5 }]]);
      const fetcher = makeFetcher(snapshots);
      const local = createLocalCopy({
        slices: ['counter'],
        channel,
        fetcher,
      });

      await local.init();
      expect(local.get('counter')).toEqual({ count: 7 });
      expect(local.getSeq('counter')).toBe(5);
    });

    it('does not apply a patch until the initial snapshot resolves', async () => {
      const channel = makeChannel('lc-buffer');
      const snapshots = new Map([['counter', { value: { count: 0 }, seq: 0 }]]);
      const fetcher = makeFetcher(snapshots);
      const local = createLocalCopy({
        slices: ['counter'],
        channel,
        fetcher,
      });

      const initP = local.init();
      channel.post({
        slice: 'counter',
        patch: [{ op: 'replace', path: ['count'], value: 1 }],
        seq: 1,
      });
      await initP;

      expect(local.get('counter')).toEqual({ count: 1 });
    });
  });

  describe('ordering and delivery', () => {
    it('applies patches in sequence order', async () => {
      const channel = makeChannel('lc-order');
      const snapshots = new Map([['counter', { value: { count: 0 }, seq: 0 }]]);
      const fetcher = makeFetcher(snapshots);
      const local = createLocalCopy({
        slices: ['counter'],
        channel,
        fetcher,
      });
      await local.init();

      channel.post({
        slice: 'counter',
        patch: [{ op: 'replace', path: ['count'], value: 1 }],
        seq: 1,
      });
      channel.post({
        slice: 'counter',
        patch: [{ op: 'replace', path: ['count'], value: 2 }],
        seq: 2,
      });

      await flush();
      expect(local.get('counter')).toEqual({ count: 2 });
    });

    it('ignores duplicate and stale sequence numbers', async () => {
      const channel = makeChannel('lc-dupes');
      const snapshots = new Map([['counter', { value: { count: 0 }, seq: 0 }]]);
      const fetcher = makeFetcher(snapshots);
      const local = createLocalCopy({
        slices: ['counter'],
        channel,
        fetcher,
      });
      await local.init();

      channel.post({
        slice: 'counter',
        patch: [{ op: 'replace', path: ['count'], value: 1 }],
        seq: 1,
      });
      await Promise.resolve();
      channel.post({
        slice: 'counter',
        patch: [{ op: 'replace', path: ['count'], value: 99 }],
        seq: 1,
      });
      channel.post({
        slice: 'counter',
        patch: [{ op: 'replace', path: ['count'], value: 99 }],
        seq: 0,
      });
      await flush();

      expect(local.get('counter')).toEqual({ count: 1 });
    });
  });

  describe('gap recovery', () => {
    it('re-fetches on a sequence gap and resumes from the fresh snapshot', async () => {
      const channel = makeChannel('lc-gap');
      const snapshots = new Map([['counter', { value: { count: 0 }, seq: 0 }]]);
      const fetcher = makeFetcher(snapshots);
      const local = createLocalCopy({
        slices: ['counter'],
        channel,
        fetcher,
      });
      await local.init();

      snapshots.set('counter', { value: { count: 8 }, seq: 8 });
      channel.post({
        slice: 'counter',
        patch: [{ op: 'replace', path: ['count'], value: 9 }],
        seq: 9,
      });

      await flush();
      expect(local.get('counter')).toEqual({ count: 9 });
    });
  });

  describe('reactivity', () => {
    it('invalidates a Signal.Computed that reads the slice when a patch is applied', async () => {
      const channel = makeChannel('lc-react');
      const snapshots = new Map([['counter', { value: { count: 0 }, seq: 0 }]]);
      const fetcher = makeFetcher(snapshots);
      const local = createLocalCopy({
        slices: ['counter'],
        channel,
        fetcher,
      });
      await local.init();

      const computed = new Signal.Computed(() => (local.get('counter') as { count: number }).count);
      expect(computed.get()).toBe(0);

      channel.post({
        slice: 'counter',
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
      const snapshots = new Map([['counter', { value: { count: 0 }, seq: 0 }]]);
      const fetcher = makeFetcher(snapshots);
      const local = createLocalCopy({
        slices: ['counter'],
        channel,
        fetcher,
      });
      await local.init();

      local.dispose();
      channel.post({
        slice: 'counter',
        patch: [{ op: 'replace', path: ['count'], value: 1 }],
        seq: 1,
      });
      await flush();
      expect(local.get('counter')).toEqual({ count: 0 });
    });
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}
