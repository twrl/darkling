import { z } from 'zod';

import type { ServiceDeclaration } from '../src/declaration.js';
import { ServiceImplementation } from '../src/service-implementation.js';
import type { HostContext } from '../src/service-implementation.js';
import type { ServiceCallContext } from '../src/service-call-context.js';

/**
 * A calculator service implementation with named methods.
 */
class CalculatorImplementation extends ServiceImplementation {
  add(params: { a: number; b: number }, _context: ServiceCallContext) {
    return Promise.resolve({ result: params.a + params.b });
  }

  greet(params: { name: string }, _context: ServiceCallContext) {
    return Promise.resolve({ message: `Hello, ${params.name}!` });
  }
}

export const calculatorImplementation = CalculatorImplementation;

/**
 * A sample service declaration for testing: a "calculator" service with an
 * `add` function and a `greet` function.
 */
export const calculatorDeclaration = {
  id: 'calculator',
  functions: {
    add: {
      params: z.object({ a: z.number(), b: z.number() }),
      returns: z.object({ result: z.number() }),
      description: 'Add two numbers',
    },
    greet: {
      params: z.object({ name: z.string() }),
      returns: z.object({ message: z.string() }),
      description: 'Greet someone',
    },
  },
  implementationLoader: () => Promise.resolve(calculatorImplementation),
} as const satisfies ServiceDeclaration;

export type CalculatorDeclaration = typeof calculatorDeclaration;

/**
 * A service implementation that always throws.
 */
class FailingImplementation extends ServiceImplementation {
  boom(_params: unknown, _context: ServiceCallContext): Promise<unknown> {
    throw new Error('Something went wrong');
  }
}

export const failingImplementation = FailingImplementation;

export const failingDeclaration = {
  id: 'failing',
  functions: {
    boom: {
      params: z.object({}),
      returns: z.object({ ok: z.boolean() }),
    },
  },
  implementationLoader: () => Promise.resolve(failingImplementation),
} as const satisfies ServiceDeclaration;

export type FailingDeclaration = typeof failingDeclaration;

/**
 * A service with a behaviour for testing fire-and-forget dispatch.
 */
let lastBehaviourParams: unknown = null;

class BehaviourImplementation extends ServiceImplementation {
  ping(params: { message: string }, _context: ServiceCallContext): Promise<void> {
    lastBehaviourParams = params;
    return Promise.resolve();
  }

  getStatus(_params: unknown, _context: ServiceCallContext) {
    return Promise.resolve({ received: lastBehaviourParams });
  }
}

export const behaviourImplementation = BehaviourImplementation;

export function resetBehaviourCapture(): void {
  lastBehaviourParams = null;
}

export function getLastBehaviourParams(): unknown {
  return lastBehaviourParams;
}

export const behaviourDeclaration = {
  id: 'behaviour-test',
  functions: {
    getStatus: {
      params: z.object({}),
      returns: z.object({ received: z.unknown() }),
    },
  },
  behaviours: {
    ping: {
      params: z.object({ message: z.string() }),
      description: 'A fire-and-forget ping',
    },
  },
  implementationLoader: () => Promise.resolve(behaviourImplementation),
} as const satisfies ServiceDeclaration;

/** A minimal `HostContext` for testing, with a no-op client. */
export function createTestHostContext(): HostContext {
  return { client: null as never };
}

/**
 * A service that calls another service through its RuntimeClient, for testing
 * service-to-service calls through the broker.
 */
class CallerImplementation extends ServiceImplementation {
  async compute(params: { a: number; b: number }, _context: ServiceCallContext) {
    const calc = this.hostContext.client.proxy(calculatorDeclaration);
    const result = await calc.add({ a: params.a, b: params.b });
    return { called: true, result };
  }
}

export const callerImplementation = CallerImplementation;

export const callerDeclaration = {
  id: 'caller',
  functions: {
    compute: {
      params: z.object({ a: z.number(), b: z.number() }),
      returns: z.object({
        called: z.boolean(),
        result: z.object({ result: z.number() }),
      }),
      description: 'Calls the calculator service and returns the result',
    },
  },
  implementationLoader: () => Promise.resolve(callerImplementation),
} as const satisfies ServiceDeclaration;

export type CallerDeclaration = typeof callerDeclaration;
