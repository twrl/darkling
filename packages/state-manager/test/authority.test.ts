/**
 * Tests for the {@link Authority}: serialised update processing, schema
 * validation, invariants, optimistic concurrency, and broadcast.
 *
 * @see specs/state-manager.spec.md#authority
 * @see specs/state-manager.spec.md#update-proposals
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';

import { Authority } from '../src/authority.js';
import { createPatchChannel } from '../src/broadcast.js';
import { PatchNotApplicableError, StaleBasisError, StateInvariantError } from '../src/errors.js';
import { defineSlice } from '../src/model.js';
import type { PatchMessage } from '../src/broadcast.js';

import { InMemoryBroadcastChannel, inMemoryChannelFactory, unknownSlice } from './fixtures.js';

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
  describe('acceptance', () => {
    it('accepts a valid proposal, assigns the next sequence number, broadcasts, and acknowledges', async () => {
      const { channel, received } = setup();
      const slice = defineSlice({
        id: 'interface',
        schema: z.unknown(),
      });
      const authority = new Authority(new Map([['interface', slice]]), channel);
      authority.init('interface', { document: 'a' });

      // A patch replacing document 'a' with 'b'.
      const patch = [{ op: 'replace' as const, path: ['document'], value: 'b' }];
      const ack = await authority.proposeUpdate({
        slice: 'interface',
        patch,
        basisSeq: 0,
        source: 'ui',
      });

      expect(ack).toEqual({ seq: 1 });
      expect(authority.getSnapshot('interface').value).toEqual({ document: 'b' });
      expect(authority.getSnapshot('interface').seq).toBe(1);
      expect(received).toEqual([{ slice: 'interface', patch, seq: 1 }]);
    });
  });

  describe('optimistic concurrency', () => {
    it('rejects a stale-basis proposal and does not broadcast', async () => {
      const { channel, received } = setup();
      const slice = defineSlice({
        id: 'interface',
        schema: z.unknown(),
      });
      const authority = new Authority(new Map([['interface', slice]]), channel);
      authority.init('interface', { document: 'a' });

      // First update succeeds, advancing seq to 1.
      await authority.proposeUpdate({
        slice: 'interface',
        patch: [{ op: 'replace', path: ['document'], value: 'b' }],
        basisSeq: 0,
        source: 'ui',
      });

      // A second proposal with a stale basis (0) must reject.
      await expect(
        authority.proposeUpdate({
          slice: 'interface',
          patch: [{ op: 'replace', path: ['document'], value: 'c' }],
          basisSeq: 0,
          source: 'guide',
        }),
      ).rejects.toBeInstanceOf(StaleBasisError);

      expect(received).toHaveLength(1); // only the first broadcast
      expect(authority.getSnapshot('interface').value).toEqual({ document: 'b' });
    });
  });

  describe('schema validity', () => {
    it('rejects a proposal whose resulting value fails the slice schema', async () => {
      const { channel, received } = setup();
      const slice = defineSlice({
        id: 'session',
        schema: z.object({ count: z.number() }),
      });
      const authority = new Authority(new Map([['session', slice]]), channel);
      authority.init('session', { count: 0 });

      // A patch that would set count to a string fails the schema.
      await expect(
        authority.proposeUpdate({
          slice: 'session',
          patch: [{ op: 'replace', path: ['count'], value: 'not-a-number' }],
          basisSeq: 0,
          source: 'service',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

      expect(received).toHaveLength(0);
      expect(authority.getSnapshot('session').value).toEqual({ count: 0 });
    });
  });

  describe('slice invariants', () => {
    it('runs invariant functions and rejects when one rejects', async () => {
      const { channel, received } = setup();
      const slice = defineSlice({
        id: 'session',
        schema: z.object({ count: z.number() }),
        invariants: [
          (value) =>
            value.count <= 10
              ? { accepted: true }
              : { accepted: false, reason: 'count must not exceed 10' },
        ],
      });
      const authority = new Authority(new Map([['session', slice]]), channel);
      authority.init('session', { count: 0 });

      // An update within the invariant succeeds.
      await authority.proposeUpdate({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 5 }],
        basisSeq: 0,
        source: 'ui',
      });
      expect(received).toHaveLength(1);

      // An update violating the invariant rejects.
      await expect(
        authority.proposeUpdate({
          slice: 'session',
          patch: [{ op: 'replace', path: ['count'], value: 11 }],
          basisSeq: 1,
          source: 'ui',
        }),
      ).rejects.toBeInstanceOf(StateInvariantError);

      expect(received).toHaveLength(1);
      expect(authority.getSnapshot('session').value).toEqual({ count: 5 });
    });

    it('passes the proposal source to invariant functions', async () => {
      const { channel } = setup();
      const sources: string[] = [];
      const slice = defineSlice({
        id: 'session',
        schema: z.object({ count: z.number() }),
        invariants: [
          (_value, ctx) => {
            sources.push(ctx.source);
            return { accepted: true };
          },
        ],
      });
      const authority = new Authority(new Map([['session', slice]]), channel);
      authority.init('session', { count: 0 });

      await authority.proposeUpdate({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 1 }],
        basisSeq: 0,
        source: 'guide',
      });
      await authority.proposeUpdate({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 2 }],
        basisSeq: 1,
        source: 'ui',
      });

      expect(sources).toEqual(['guide', 'ui']);
    });
  });

  describe('patch applicability', () => {
    it('rejects a patch that cannot be applied to the authoritative value', async () => {
      const { channel, received } = setup();
      const slice = unknownSlice('interface');
      const authority = new Authority(new Map([['interface', slice]]), channel);
      authority.init('interface', { document: 'a' });

      // A patch targeting a non-existent array index path.
      await expect(
        authority.proposeUpdate({
          slice: 'interface',
          patch: [{ op: 'replace', path: ['items', 5, 'name'], value: 'x' }],
          basisSeq: 0,
          source: 'ui',
        }),
      ).rejects.toBeInstanceOf(PatchNotApplicableError);

      expect(received).toHaveLength(0);
    });
  });

  describe('serialisation', () => {
    it('processes concurrent proposals in arrival order with distinct sequence numbers', async () => {
      const { channel, received } = setup();
      const slice = defineSlice({
        id: 'session',
        schema: z.object({ count: z.number() }),
      });
      const authority = new Authority(new Map([['session', slice]]), channel);
      authority.init('session', { count: 0 });

      // Issue three proposals concurrently. Each references its expected
      // basis; the authority serialises them so that the basis of each
      // matches the seq produced by the previous. We simulate a proposer
      // that chains: each proposal is issued after observing the prior ack.
      // To test serialisation, issue them with bases 0, 1, 2 in order.
      const ack1 = authority.proposeUpdate({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 1 }],
        basisSeq: 0,
        source: 'ui',
      });
      const ack2 = authority.proposeUpdate({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 2 }],
        basisSeq: 1,
        source: 'ui',
      });
      const ack3 = authority.proposeUpdate({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 3 }],
        basisSeq: 2,
        source: 'ui',
      });

      const results = await Promise.all([ack1, ack2, ack3]);
      expect(results.map((a) => a.seq)).toEqual([1, 2, 3]);
      expect(received.map((m) => m.seq)).toEqual([1, 2, 3]);
      expect(authority.getSnapshot('session').value).toEqual({ count: 3 });
    });
  });
});
