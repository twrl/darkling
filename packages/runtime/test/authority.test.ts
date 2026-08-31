import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';

import { Authority } from '../src/authority.js';
import { createPatchChannel } from '../src/broadcast.js';
import { defineSlice } from '../src/state-model.js';
import { StaleBasisError, SliceNotRegisteredError } from '../src/errors.js';
import type { PatchMessage } from '../src/broadcast.js';

import {
  InMemoryBroadcastChannel,
  inMemoryChannelFactory,
  counterSlice,
} from './state-fixtures.js';

beforeEach(() => InMemoryBroadcastChannel.reset());

function setup() {
  const channelName = 'test-state';
  const channel = createPatchChannel({
    channelName,
    createChannel: inMemoryChannelFactory,
  });
  const received: PatchMessage[] = [];
  channel.onMessage((m) => received.push(m));
  return { channel, received };
}

describe('Authority', () => {
  describe('mutation acceptance', () => {
    it('accepts a valid mutation, assigns the next sequence number, broadcasts, and acknowledges', async () => {
      const { channel, received } = setup();
      const slice = defineSlice(counterSlice('counter'));
      const authority = new Authority(channel);
      authority.registerSlice(slice);
      authority.init('counter', { count: 0 });

      const ack = await authority.mutate({
        slice: 'counter',
        mutation: 'increment',
        params: { by: 5 },
        basisSeq: 0,
      });

      expect(ack).toEqual({ seq: 1 });
      expect(authority.getSnapshot('counter').value).toEqual({ count: 5 });
      expect(authority.getSnapshot('counter').seq).toBe(1);
      // A patch message should have been broadcast.
      expect(received).toHaveLength(1);
      expect(received[0]?.slice).toBe('counter');
      expect(received[0]?.seq).toBe(1);
    });

    it('applies successive mutations with incrementing sequence numbers', async () => {
      const { channel, received } = setup();
      const slice = defineSlice(counterSlice('counter'));
      const authority = new Authority(channel);
      authority.registerSlice(slice);
      authority.init('counter', { count: 0 });

      await authority.mutate({
        slice: 'counter',
        mutation: 'increment',
        params: { by: 1 },
        basisSeq: 0,
      });
      await authority.mutate({
        slice: 'counter',
        mutation: 'increment',
        params: { by: 2 },
        basisSeq: 1,
      });

      expect(authority.getSnapshot('counter').value).toEqual({ count: 3 });
      expect(authority.getSnapshot('counter').seq).toBe(2);
      expect(received.map((m) => m.seq)).toEqual([1, 2]);
    });
  });

  describe('optimistic concurrency', () => {
    it('rejects a stale-basis mutation and does not broadcast', async () => {
      const { channel, received } = setup();
      const slice = defineSlice(counterSlice('counter'));
      const authority = new Authority(channel);
      authority.registerSlice(slice);
      authority.init('counter', { count: 0 });

      await authority.mutate({
        slice: 'counter',
        mutation: 'increment',
        params: { by: 1 },
        basisSeq: 0,
      });

      await expect(
        authority.mutate({
          slice: 'counter',
          mutation: 'increment',
          params: { by: 1 },
          basisSeq: 0,
        }),
      ).rejects.toBeInstanceOf(StaleBasisError);

      expect(received).toHaveLength(1);
      expect(authority.getSnapshot('counter').value).toEqual({ count: 1 });
    });
  });

  describe('schema validity', () => {
    it('rejects a mutation whose resulting value fails the slice schema', async () => {
      const { channel, received } = setup();
      const slice = defineSlice({
        id: 'typed',
        schema: z.object({ count: z.number() }),
        mutations: {
          setString: {
            params: z.object({ value: z.string() }),
            transition: (draft: { count: number }, params: { value: string }) => {
              (draft as unknown as { count: unknown }).count = params.value;
            },
          },
        },
      });
      const authority = new Authority(channel);
      authority.registerSlice(slice);
      authority.init('typed', { count: 0 });

      await expect(
        authority.mutate({
          slice: 'typed',
          mutation: 'setString',
          params: { value: 'not-a-number' },
          basisSeq: 0,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

      expect(received).toHaveLength(0);
      expect(authority.getSnapshot('typed').value).toEqual({ count: 0 });
    });
  });

  describe('unregistered slice', () => {
    it('rejects a mutation to an unregistered slice', async () => {
      const { channel } = setup();
      const authority = new Authority(channel);

      await expect(
        authority.mutate({
          slice: 'unknown',
          mutation: 'increment',
          params: { by: 1 },
          basisSeq: 0,
        }),
      ).rejects.toBeInstanceOf(SliceNotRegisteredError);
    });
  });

  describe('serialisation', () => {
    it('processes concurrent mutations in arrival order with distinct sequence numbers', async () => {
      const { channel, received } = setup();
      const slice = defineSlice(counterSlice('counter'));
      const authority = new Authority(channel);
      authority.registerSlice(slice);
      authority.init('counter', { count: 0 });

      const ack1 = authority.mutate({
        slice: 'counter',
        mutation: 'increment',
        params: { by: 1 },
        basisSeq: 0,
      });
      const ack2 = authority.mutate({
        slice: 'counter',
        mutation: 'increment',
        params: { by: 1 },
        basisSeq: 1,
      });
      const ack3 = authority.mutate({
        slice: 'counter',
        mutation: 'increment',
        params: { by: 1 },
        basisSeq: 2,
      });

      const results = await Promise.all([ack1, ack2, ack3]);
      expect(results.map((a) => a.seq)).toEqual([1, 2, 3]);
      expect(received.map((m) => m.seq)).toEqual([1, 2, 3]);
      expect(authority.getSnapshot('counter').value).toEqual({ count: 3 });
    });
  });
});
