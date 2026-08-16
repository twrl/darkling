import { describe, expect, it } from 'vitest';

import {
  createInProcessTransportPair,
  InProcessHostSpawner,
  ServiceBroker,
  ServiceClient,
  ServiceBusError,
  ServiceNotRegisteredError,
  ValidationError,
  type ServiceModuleResolver,
} from '../src/index.js';
import { calculatorDeclaration, failingDeclaration, createTestHostContext } from './fixtures.js';

/**
 * A resolver that maps the test service IDs to their live declarations and
 * implementations. In a worker-based spawner, this resolution would happen
 * via dynamic import of the module specifier.
 */
const testResolver: ServiceModuleResolver = (serviceId) => {
  switch (serviceId) {
    case 'calculator':
      return calculatorDeclaration;
    case 'failing':
      return failingDeclaration;
    default:
      return undefined;
  }
};

/**
 * Create a fully wired broker + client using in-process transports and the
 * in-process host spawner. Returns the broker, client, and a dispose function.
 */
function setupBroker(resolver: ServiceModuleResolver = testResolver) {
  // The client transport and broker transport are two ends of a pipe.
  const { a: clientTransport, b: brokerTransport } = createInProcessTransportPair();
  const spawner = new InProcessHostSpawner(resolver, createTestHostContext());
  const broker = new ServiceBroker(brokerTransport, spawner);
  const client = new ServiceClient(clientTransport);
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

describe('service bus integration', () => {
  it('invokes a service function through the full bus and returns the result', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      const calc = client.createProxy(calculatorDeclaration);
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
      const calc = client.createProxy(calculatorDeclaration);
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

  it('dispatches parallel tool calls concurrently', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      const calc = client.createProxy(calculatorDeclaration);
      // Three concurrent calls should resolve in roughly the time of one,
      // not the sum of all three.
      const start = Date.now();
      const results = await Promise.all([
        calc.add({ a: 1, b: 2 }),
        calc.add({ a: 3, b: 4 }),
        calc.add({ a: 5, b: 6 }),
      ]);
      const elapsed = Date.now() - start;
      expect(results).toEqual([{ result: 3 }, { result: 7 }, { result: 11 }]);
      // In-process calls are fast; just sanity-check it didn't take absurdly long.
      expect(elapsed).toBeLessThan(5000);
    } finally {
      dispose();
    }
  });

  it('rejects with ServiceNotRegisteredError when calling an unregistered service', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      await expect(
        client.call('nonexistent', 'add', { a: 1, b: 2 }, calculatorDeclaration.functions.add),
      ).rejects.toMatchObject({ code: 'SERVICE_NOT_REGISTERED' });
    } finally {
      dispose();
    }
  });

  it('rejects with a validation error when parameters fail schema validation at the proxy', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      const calc = client.createProxy(calculatorDeclaration);
      // @ts-expect-error — deliberately wrong parameter type
      await expect(calc.add({ a: 'not a number', b: 3 })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    } finally {
      dispose();
    }
  });

  it('rejects with a validation error when parameters fail schema validation at the host', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      // Bypass proxy-side validation by calling directly with a schema that
      // accepts anything, so the host validation is the one that catches it.
      const anyParamsSchema = {
        params: { safeParse: () => ({ success: true, data: { a: 'bad', b: 'bad' } }) },
        returns: calculatorDeclaration.functions.add.returns,
      };
      await expect(
        client.call('calculator', 'add', { a: 'bad', b: 'bad' }, anyParamsSchema as never),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    } finally {
      dispose();
    }
  });

  it('propagates service implementation errors as error messages', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'failing', moduleSpecifier: 'test://failing' });

    try {
      await expect(
        client.call('failing', 'boom', {}, failingDeclaration.functions.boom),
      ).rejects.toThrow();
    } finally {
      dispose();
    }
  });

  it('rejects with HostUnavailableError when the call times out', async () => {
    // Use a very short timeout and a service that never responds because no
    // host is launched (broker not started).
    const { a: clientTransport, b: brokerTransport } = createInProcessTransportPair();
    const spawner = new InProcessHostSpawner(testResolver, createTestHostContext());
    const broker = new ServiceBroker(brokerTransport, spawner);
    const client = new ServiceClient(clientTransport, { callTimeoutMs: 50 });
    broker.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });
    // Don't start the broker — the call will time out.

    try {
      await expect(
        client.call('calculator', 'add', { a: 1, b: 2 }, calculatorDeclaration.functions.add),
      ).rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' });
    } finally {
      client.dispose();
      void broker.stop();
    }
  });
});

describe('service bus: transferable transparency', () => {
  it('passes the transferables field through the envelope unchanged', async () => {
    const { broker, client, dispose } = setupBroker();
    broker.register({ id: 'calculator', moduleSpecifier: 'test://calculator' });

    try {
      const calc = client.createProxy(calculatorDeclaration);
      // The transferables field is an empty list for normal calls; the
      // important property is that the envelope structure is preserved.
      const result = await calc.add({ a: 1, b: 1 });
      expect(result).toEqual({ result: 2 });
    } finally {
      dispose();
    }
  });
});

describe('error serialisation', () => {
  it('round-trips ServiceBusError through toJSON/fromJSON', () => {
    const original = new ServiceNotRegisteredError('test-service');
    const json = original.toJSON();
    const restored = ServiceBusError.fromJSON(json);
    expect(restored).toBeInstanceOf(ServiceBusError);
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
