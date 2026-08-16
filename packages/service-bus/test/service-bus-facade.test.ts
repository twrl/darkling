import { afterEach, describe, expect, it } from 'vitest';

import {
  ServiceBus,
  createInProcessBrokerFactory,
  getServiceBus,
  peekServiceBus,
  resetServiceBus,
  type ServiceModuleResolver,
} from '../src/index.js';
import { calculatorDeclaration, createTestHostContext } from './fixtures.js';

const resolver: ServiceModuleResolver = (serviceId) => {
  if (serviceId === 'calculator') {
    return calculatorDeclaration;
  }
  return undefined;
};

function createBus(): ServiceBus {
  return new ServiceBus({
    brokerFactory: createInProcessBrokerFactory(resolver, createTestHostContext()),
  });
}

describe('ServiceBus facade', () => {
  it('creates a proxy and invokes a service through the full bus', async () => {
    const bus = createBus();
    bus.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      const calc = bus.createProxy(calculatorDeclaration);
      const result = await calc.add({ a: 2, b: 3 });
      expect(result).toEqual({ result: 5 });
    } finally {
      await bus.dispose();
    }
  });

  it('exposes the ServiceClient', async () => {
    const bus = createBus();
    bus.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      expect(bus.serviceClient).toBeDefined();
      const result = await bus.serviceClient.call(
        'calculator',
        'greet',
        { name: 'Guide' },
        calculatorDeclaration.functions.greet,
      );
      expect(result).toEqual({ message: 'Hello, Guide!' });
    } finally {
      await bus.dispose();
    }
  });

  it('can be disposed and stops the broker', async () => {
    const bus = createBus();
    bus.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });
    await bus.dispose();
    // A disposed bus should not throw on double-dispose.
    await bus.dispose();
  });
});

describe('ServiceBus singleton', () => {
  afterEach(async () => {
    await resetServiceBus();
  });

  it('creates and returns the same singleton', () => {
    const bus1 = getServiceBus({
      brokerFactory: createInProcessBrokerFactory(resolver, createTestHostContext()),
    });
    const bus2 = getServiceBus({
      brokerFactory: createInProcessBrokerFactory(resolver, createTestHostContext()),
    });
    expect(bus1).toBe(bus2);
    expect(peekServiceBus()).toBe(bus1);
  });

  it('resetServiceBus clears the singleton', async () => {
    const bus = getServiceBus({
      brokerFactory: createInProcessBrokerFactory(resolver, createTestHostContext()),
    });
    expect(peekServiceBus()).toBe(bus);

    await resetServiceBus();
    expect(peekServiceBus()).toBeNull();
  });

  it('creates a fresh singleton after reset', async () => {
    const bus1 = getServiceBus({
      brokerFactory: createInProcessBrokerFactory(resolver, createTestHostContext()),
    });
    await resetServiceBus();
    const bus2 = getServiceBus({
      brokerFactory: createInProcessBrokerFactory(resolver, createTestHostContext()),
    });
    expect(bus2).not.toBe(bus1);
  });
});
