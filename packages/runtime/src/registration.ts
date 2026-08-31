import type { ServiceId } from './envelope.js';
import type { ServiceMetadata } from './declaration.js';

/**
 * A module specifier — a URL or path string resolvable by `import()`. The
 * module exports a declaration as its default export. Each worker that needs
 * the live declaration imports the module itself; the specifier is the
 * serializable handle that crosses `postMessage` boundaries.
 *
 * @see specs/runtime.spec.md#registration-and-discovery
 */
export type ModuleSpecifier = string;

/**
 * A serializable service registration record. This is the data that crosses
 * `postMessage` from the main thread to the broker worker.
 *
 * It contains only structured-cloneable fields: the service ID, the module
 * specifier from which the declaration can be loaded, and the plain-data
 * metadata used by the broker for routing and activation decisions. It does
 * **not** contain the live `ServiceDeclaration` (with Zod schemas) or the
 * implementation — those are obtained by importing the declaration module in
 * whichever worker needs them.
 *
 * @see specs/runtime.spec.md#service-registration
 */
export interface ServiceRegistration {
  /** A unique name for the service. */
  id: ServiceId;
  /** The module specifier of the declaration module (`*.service.ts`). */
  moduleSpecifier: ModuleSpecifier;
  /** Service-level metadata used by the broker for routing and activation. */
  metadata?: ServiceMetadata;
}

/**
 * A serializable slice registration record. The authority receives the
 * registration, dynamically imports the declaration module (`*.slice.ts`) to
 * obtain the live `SliceDeclaration`, and stores it internally.
 *
 * @see specs/runtime.spec.md#slice-registration
 */
export interface SliceRegistration {
  /** The unique slice identifier. */
  id: string;
  /** The module specifier of the declaration module (`*.slice.ts`). */
  moduleSpecifier: ModuleSpecifier;
}

/**
 * The registry pseudo-slice value. Records all registered services and slices
 * for reactive discovery. The authority maintains this pseudo-slice and
 * propagates it via the same state-change propagation mechanism as regular
 * slices.
 *
 * @see specs/runtime.spec.md#registry-pseudo-slice
 */
export interface RegistryValue {
  /** Registered services, keyed by service ID. */
  services: Record<string, ServiceRegistration>;
  /** Registered slices, keyed by slice ID. */
  slices: Record<string, SliceRegistration>;
}

/**
 * The initial (empty) registry value.
 */
export const EMPTY_REGISTRY: RegistryValue = {
  services: {},
  slices: {},
};
