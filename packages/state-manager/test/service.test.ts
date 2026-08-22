/**
 * Integration tests for the state manager authority as a service on the bus.
 *
 * Verifies that `proposeUpdate` and `getSnapshot` are invocable through the
 * service bus, that accepted updates broadcast over the `BroadcastChannel`,
 * and that rejection errors propagate through the bus promise.
 *
 * @see specs/state-manager.spec.md#authority
 * @see specs/state-manager.spec.md#update-path
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';

import {
  ServiceBus,
  createInProcessBrokerFactory,
  type ServiceModuleResolver,
} from '@darkling/service-bus';

import { declaration } from '../src/service-declaration.js';
import { createPatchChannel } from '../src/broadcast.js';
import type { PatchMessage } from '../src/broadcast.js';
import type { HostContext } from '@darkling/service-bus';

import { InMemoryBroadcastChannel, inMemoryChannelFactory } from './fixtures.js';

beforeEach(() => InMemoryBroadcastChannel.reset());

const channelName = 'sm-int';

function makeHostContext(): HostContext {
  return {
    serviceClient: {},
    stateManager: {
      slices: [
        {
          id: 'session',
          schema: z.object({ count: z.number() }),
          invariants: [
            (value: { count: number }) =>
              value.count <= 100
                ? { accepted: true }
                : { accepted: false, reason: 'count must not exceed 100' },
          ],
        },
      ],
      channelName,
      initialValues: { session: { count: 0 } },
      createChannel: inMemoryChannelFactory,
    },
  } as HostContext & { stateManager: unknown };
}

const resolver: ServiceModuleResolver = (serviceId) => {
  if (serviceId === 'state-manager') {
    return declaration;
  }
  return undefined;
};

function createBus(): ServiceBus {
  const bus = new ServiceBus({
    brokerFactory: createInProcessBrokerFactory(resolver, makeHostContext()),
  });
  bus.register({ id: 'state-manager', moduleSpecifier: 'test://state-manager' });
  return bus;
}

describe('StateManagerService via the bus', () => {
  it('accepts a proposed update through the bus and broadcasts the patch', async () => {
    const bus = await createBus();
    const channel = createPatchChannel({
      channelName,
      createChannel: inMemoryChannelFactory,
    });
    const received: PatchMessage[] = [];
    channel.onMessage((m) => received.push(m));

    try {
      const proxy = bus.createProxy(declaration) as {
        proposeUpdate: (params: {
          slice: string;
          patch: { op: 'replace' | 'remove' | 'add'; path: (string | number)[]; value?: unknown }[];
          basisSeq: number;
          source: 'ui' | 'guide' | 'service';
        }) => Promise<{ seq: number }>;
        getSnapshot: (params: { slice: string }) => Promise<{ value: unknown; seq: number }>;
      };
      const ack = await proxy.proposeUpdate({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 5 }],
        basisSeq: 0,
        source: 'ui',
      });
      expect(ack).toEqual({ seq: 1 });

      const snapshot = await proxy.getSnapshot({ slice: 'session' });
      expect(snapshot).toEqual({ value: { count: 5 }, seq: 1 });

      expect(received).toEqual([
        { slice: 'session', patch: [{ op: 'replace', path: ['count'], value: 5 }], seq: 1 },
      ]);
    } finally {
      await bus.dispose();
      channel.close();
    }
  });

  it('propagates a rejection error through the bus promise', async () => {
    const bus = await createBus();
    try {
      const proxy = bus.createProxy(declaration) as {
        proposeUpdate: (params: {
          slice: string;
          patch: { op: 'replace' | 'remove' | 'add'; path: (string | number)[]; value?: unknown }[];
          basisSeq: number;
          source: 'ui' | 'guide' | 'service';
        }) => Promise<{ seq: number }>;
        getSnapshot: (params: { slice: string }) => Promise<{ value: unknown; seq: number }>;
      };
      // Violate the invariant (count > 100).
      await expect(
        proxy.proposeUpdate({
          slice: 'session',
          patch: [{ op: 'replace', path: ['count'], value: 101 }],
          basisSeq: 0,
          source: 'ui',
        }),
      ).rejects.toMatchObject({ code: 'STATE_INVARIANT' });
    } finally {
      await bus.dispose();
    }
  });

  it('rejects a stale-basis proposal through the bus', async () => {
    const bus = await createBus();
    try {
      const proxy = bus.createProxy(declaration) as {
        proposeUpdate: (params: {
          slice: string;
          patch: { op: 'replace' | 'remove' | 'add'; path: (string | number)[]; value?: unknown }[];
          basisSeq: number;
          source: 'ui' | 'guide' | 'service';
        }) => Promise<{ seq: number }>;
        getSnapshot: (params: { slice: string }) => Promise<{ value: unknown; seq: number }>;
      };
      await proxy.proposeUpdate({
        slice: 'session',
        patch: [{ op: 'replace', path: ['count'], value: 1 }],
        basisSeq: 0,
        source: 'ui',
      });
      await expect(
        proxy.proposeUpdate({
          slice: 'session',
          patch: [{ op: 'replace', path: ['count'], value: 2 }],
          basisSeq: 0,
          source: 'ui',
        }),
      ).rejects.toMatchObject({ code: 'STALE_BASIS' });
    } finally {
      await bus.dispose();
    }
  });
});
