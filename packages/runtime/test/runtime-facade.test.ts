import { afterEach, describe, expect, it } from 'vitest';

import {
  Runtime,
  createInProcessBrokerFactory,
  getRuntime,
  peekRuntime,
  resetRuntime,
  type ServiceModuleResolver,
} from '../src/index.js';
import { calculatorDeclaration, createTestHostContext } from './fixtures.js';

const resolver: ServiceModuleResolver = (serviceId) => {
  if (serviceId === 'calculator') {
    return calculatorDeclaration;
  }
  return undefined;
};

function createRuntime(): Runtime {
  return new Runtime({
    brokerFactory: createInProcessBrokerFactory(resolver, createTestHostContext()),
  });
}

describe('Runtime facade', () => {
  it('creates a proxy and invokes a service through the full runtime', async () => {
    const runtime = createRuntime();
    runtime.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      const calc = runtime.proxy(calculatorDeclaration);
      const result = await calc.add({ a: 2, b: 3 });
      expect(result).toEqual({ result: 5 });
    } finally {
      await runtime.dispose();
    }
  });

  it('exposes the RuntimeClient', async () => {
    const runtime = createRuntime();
    runtime.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      expect(runtime.runtimeClient).toBeDefined();
      const result = await runtime.runtimeClient.call('calculator', 'greet', { name: 'Guide' });
      expect(result).toEqual({ message: 'Hello, Guide!' });
    } finally {
      await runtime.dispose();
    }
  });

  it('can be disposed and stops the broker', async () => {
    const runtime = createRuntime();
    runtime.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });
    await runtime.dispose();
    await runtime.dispose();
  });
});

describe('Runtime singleton', () => {
  afterEach(async () => {
    await resetRuntime();
  });

  it('creates and returns the same singleton', () => {
    const r1 = getRuntime({
      brokerFactory: createInProcessBrokerFactory(resolver, createTestHostContext()),
    });
    const r2 = getRuntime({
      brokerFactory: createInProcessBrokerFactory(resolver, createTestHostContext()),
    });
    expect(r1).toBe(r2);
    expect(peekRuntime()).toBe(r1);
  });

  it('resetRuntime clears the singleton', async () => {
    const r = getRuntime({
      brokerFactory: createInProcessBrokerFactory(resolver, createTestHostContext()),
    });
    expect(peekRuntime()).toBe(r);

    await resetRuntime();
    expect(peekRuntime()).toBeNull();
  });

  it('creates a fresh singleton after reset', async () => {
    const r1 = getRuntime({
      brokerFactory: createInProcessBrokerFactory(resolver, createTestHostContext()),
    });
    await resetRuntime();
    const r2 = getRuntime({
      brokerFactory: createInProcessBrokerFactory(resolver, createTestHostContext()),
    });
    expect(r2).not.toBe(r1);
  });
});
