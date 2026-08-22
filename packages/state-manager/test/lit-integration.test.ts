/**
 * Tests for the Lit integration's testable (non-DOM) surface.
 *
 * The `<state-manager-host>` element and `@consumeState()` consumer decorator
 * are exercised by typecheck and example; the service-bus package's Lit
 * integration follows the same convention (typed but not DOM-tested, since
 * the repo does not configure a DOM test environment). This test covers the
 * pure units that don't require a DOM: `createBusSnapshotFetcher` (builds a
 * `SnapshotFetcher` from a `ServiceClient` proxy) and the context key
 * identity.
 *
 * @see packages/state-manager/src/lit
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

import {
  ServiceBus,
  createInProcessBrokerFactory,
  type ServiceModuleResolver,
  type HostContext,
} from '@darkling/service-bus';

import { declaration } from '../src/service-declaration.js';
import { createBusSnapshotFetcher } from '../src/lit/state-manager-host.js';
import { stateClientContext } from '../src/lit/state-client-context.js';
import { InMemoryBroadcastChannel, inMemoryChannelFactory } from './fixtures.js';

beforeEach(() => InMemoryBroadcastChannel.reset());

const channelName = 'lit-int';

function makeHostContext(): HostContext {
  return {
    serviceClient: {},
    stateManager: {
      slices: [
        {
          id: 'session',
          schema: z.object({ count: z.number() }),
        },
      ],
      channelName,
      initialValues: { session: { count: 0 } },
      createChannel: inMemoryChannelFactory,
    },
  } as HostContext & { stateManager: unknown };
}

const resolver: ServiceModuleResolver = (serviceId) => {
  if (serviceId === 'state-manager') return declaration;
  return undefined;
};

let bus: ServiceBus;

beforeEach(() => {
  bus = new ServiceBus({
    brokerFactory: createInProcessBrokerFactory(resolver, makeHostContext()),
  });
  bus.register({ id: 'state-manager', moduleSpecifier: 'test://state-manager' });
});

afterEach(async () => {
  await bus.dispose();
});

describe('createBusSnapshotFetcher', () => {
  it('fetches a snapshot through a service-bus proxy to the authority', async () => {
    const fetcher = createBusSnapshotFetcher(bus.serviceClient);
    const snapshot = await fetcher.getSnapshot('session');
    expect(snapshot).toEqual({ value: { count: 0 }, seq: 0 });
  });

  it('reflects updates made through the bus', async () => {
    const fetcher = createBusSnapshotFetcher(bus.serviceClient);
    const proxy = bus.createProxy(declaration) as {
      proposeUpdate: (params: {
        slice: string;
        patch: { op: 'replace' | 'remove' | 'add'; path: (string | number)[]; value?: unknown }[];
        basisSeq: number;
        source: 'ui' | 'guide' | 'service';
      }) => Promise<{ seq: number }>;
    };
    await proxy.proposeUpdate({
      slice: 'session',
      patch: [{ op: 'replace', path: ['count'], value: 7 }],
      basisSeq: 0,
      source: 'ui',
    });

    const snapshot = await fetcher.getSnapshot('session');
    expect(snapshot).toEqual({ value: { count: 7 }, seq: 1 });
  });
});

describe('stateClientContext', () => {
  it('is a unique context key identified by the state-manager string', async () => {
    // @lit/context's createContext() with a string key returns a value that
    // compares equal by strict equality to the same string, so the key's
    // identity is the string itself.
    expect(stateClientContext).toBe('darkling-state-manager:local-copy');
  });
});
