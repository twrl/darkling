import { describe, expect, it } from 'vitest';

import {
  createInProcessTransportPair,
  InProcessHostSpawner,
  ServiceBroker,
  RuntimeClient,
  RuntimeError,
  ServiceNotRegisteredError,
  ValidationError,
  type ServiceModuleResolver,
} from '../src/index.js';
import {
  calculatorDeclaration,
  failingDeclaration,
  behaviourDeclaration,
  callerDeclaration,
  resetBehaviourCapture,
  getLastBehaviourParams,
  createTestHostContext,
} from './fixtures.js';

const testResolver: ServiceModuleResolver = (serviceId) => {
  switch (serviceId) {
    case 'calculator':
      return calculatorDeclaration;
    case 'failing':
      return failingDeclaration;
    case 'behaviour-test':
      return behaviourDeclaration;
    case 'caller':
      return callerDeclaration;
    default:
      return undefined;
  }
};

function setupBroker(resolver: ServiceModuleResolver = testResolver) {
  const { a: clientTransport, b: brokerTransport } = createInProcessTransportPair();
  const spawner = new InProcessHostSpawner(resolver, createTestHostContext());
  const broker = new ServiceBroker(brokerTransport, createTestHostContext(), {
    spawner,
    resolver,
  });
  const client = new RuntimeClient(clientTransport);
  broker.start();
  return {
    broker,
    client,
    dispose: () => {
      void broker.stop();
      client.dispose();
    },
  };
}

describe('runtime integration', () => {
  it('invokes a service function through the full runtime and returns the result', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      const calc = client.proxy(calculatorDeclaration);
      const result = await calc.add({ a: 2, b: 3 });
      expect(result).toEqual({ result: 5 });
    } finally {
      dispose();
    }
  });

  it('invokes multiple functions on the same service', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      const calc = client.proxy(calculatorDeclaration);
      const [sum, greeting] = await Promise.all([
        calc.add({ a: 10, b: 20 }),
        calc.greet({ name: 'Guide' }),
      ]);
      expect(sum).toEqual({ result: 30 });
      expect(greeting).toEqual({ message: 'Hello, Guide!' });
    } finally {
      dispose();
    }
  });

  it('dispatches parallel calls concurrently', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      const calc = client.proxy(calculatorDeclaration);
      const start = Date.now();
      const results = await Promise.all([
        calc.add({ a: 1, b: 2 }),
        calc.add({ a: 3, b: 4 }),
        calc.add({ a: 5, b: 6 }),
      ]);
      const elapsed = Date.now() - start;
      expect(results).toEqual([{ result: 3 }, { result: 7 }, { result: 11 }]);
      expect(elapsed).toBeLessThan(5000);
    } finally {
      dispose();
    }
  });

  it('rejects with ServiceNotRegisteredError when calling an unregistered service', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      await expect(client.call('nonexistent', 'add', { a: 1, b: 2 })).rejects.toMatchObject({
        code: 'SERVICE_NOT_REGISTERED',
      });
    } finally {
      dispose();
    }
  });

  it('rejects with a validation error when parameters fail schema validation at the host', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      // Bypass the proxy and call raw — validation happens at the host.
      await expect(client.call('calculator', 'add', { a: 'bad', b: 'bad' })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    } finally {
      dispose();
    }
  });

  it('propagates service implementation errors as error messages', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'failing', moduleSpecifier: 'test://failing' });

    try {
      await expect(client.call('failing', 'boom', {})).rejects.toThrow();
    } finally {
      dispose();
    }
  });

  it('routes a service-to-service call through the broker and returns the result', async () => {
    // The 'caller' service calls the 'calculator' service through its
    // RuntimeClient. This tests that the broker routes calls from hosts
    // (not just from the main thread) and routes returns back to the
    // correct caller.
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });
    broker.register({ id: 'caller', moduleSpecifier: 'test://caller' });

    try {
      const caller = client.proxy(callerDeclaration);
      const result = await caller.compute({ a: 7, b: 8 });
      expect(result).toEqual({ called: true, result: { result: 15 } });
    } finally {
      dispose();
    }
  });
});

describe('runtime: behaviours', () => {
  it('dispatches a fire-and-forget behaviour and the service receives it', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'behaviour-test', moduleSpecifier: 'test://behaviour-test' });
    resetBehaviourCapture();

    try {
      const proxy = client.proxy(behaviourDeclaration);
      // The behaviour method returns void.
      proxy.ping({ message: 'hello' });

      // Allow the message to be delivered and processed.
      await flush();

      // The service should have received the behaviour params.
      expect(getLastBehaviourParams()).toEqual({ message: 'hello' });
    } finally {
      dispose();
    }
  });

  it('can query the result of a behaviour via a subsequent function call', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'behaviour-test', moduleSpecifier: 'test://behaviour-test' });
    resetBehaviourCapture();

    try {
      const proxy = client.proxy(behaviourDeclaration);
      proxy.ping({ message: 'world' });
      await flush();

      const status = await proxy.getStatus({});
      expect(status).toEqual({ received: { message: 'world' } });
    } finally {
      dispose();
    }
  });
});

describe('error serialisation', () => {
  it('round-trips RuntimeError through toJSON/fromJSON', () => {
    const original = new ServiceNotRegisteredError('test-service');
    const json = original.toJSON();
    const restored = RuntimeError.fromJSON(json);
    expect(restored).toBeInstanceOf(RuntimeError);
    expect(restored.name).toBe(original.name);
    expect(restored.message).toBe(original.message);
    expect(restored.code).toBe(original.code);
  });

  it('ValidationError carries issues', () => {
    const error = new ValidationError('bad params', [{ path: ['a'], message: 'required' }]);
    const json = error.toJSON();
    expect(json.code).toBe('VALIDATION_ERROR');
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}
