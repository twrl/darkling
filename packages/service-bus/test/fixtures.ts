import { z } from 'zod';

import type { ServiceDeclaration } from '../src/declaration.js';
import { ServiceImplementation, type HostContext } from '../src/service-implementation.js';
import type { ServiceCallContext } from '../src/service-call-context.js';

/**
 * A calculator service implementation, as an abstract class subclass.
 */
class CalculatorImplementation extends ServiceImplementation {
  async invoke(
    functionName: string,
    params: unknown,
    _context: ServiceCallContext,
  ): Promise<unknown> {
    if (functionName === 'add') {
      const { a, b } = params as { a: number; b: number };
      return { result: a + b };
    }
    if (functionName === 'greet') {
      const { name } = params as { name: string };
      return { message: `Hello, ${name}!` };
    }
    throw new Error(`Unknown function: ${functionName}`);
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
 * A service implementation that always throws, for error-propagation testing.
 */
class FailingImplementation extends ServiceImplementation {
  async invoke(
    _functionName: string,
    _params: unknown,
    _context: ServiceCallContext,
  ): Promise<unknown> {
    throw new Error('Something went wrong');
  }
}

export const failingImplementation = FailingImplementation;

/**
 * A service that always throws, for error-propagation testing.
 */
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
 * A service implementation that captures the `options` it was constructed
 * with, for testing the worker-protocol options threading through the broker
 * and in-process spawner.
 */
class OptionsCapturingImplementation extends ServiceImplementation {
  readonly receivedOptions: unknown;
  constructor(hostContext: HostContext) {
    super(hostContext);
    this.receivedOptions = hostContext.options;
  }
  async invoke(
    _functionName: string,
    _params: unknown,
    _context: ServiceCallContext,
  ): Promise<unknown> {
    return { options: this.receivedOptions };
  }
}

export const optionsCapturingImplementation = OptionsCapturingImplementation;

/**
 * A service declaration whose implementation captures its host context
 * options, returning them from any function call.
 */
export const optionsCapturingDeclaration = {
  id: 'options-capturing',
  functions: {
    getOptions: {
      params: z.object({}),
      returns: z.object({ options: z.unknown() }),
    },
  },
  implementationLoader: () => Promise.resolve(optionsCapturingImplementation),
} as const satisfies ServiceDeclaration;

export type OptionsCapturingDeclaration = typeof optionsCapturingDeclaration;

/** A minimal `HostContext` for testing, with a no-op service client. */
export function createTestHostContext(): HostContext {
  return { serviceClient: {} };
}
