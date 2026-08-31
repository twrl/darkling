/**
 * @darkling/runtime — the runtime: the frontend subsystem that provides
 * distributed service execution, reactive shared state, and the communication
 * substrate over which the Guide's tool calls are dispatched, the agentic
 * model operates, and the retrieval interface is accessed.
 *
 * @see specs/runtime.spec.md
 */

// Envelope types
export type {
  Envelope,
  EnvelopeHead,
  FunctionName,
  MessageId,
  MessageType,
  ServiceId,
  TransferableRef,
} from './envelope.js';

// Declaration types
export type {
  ServiceBehaviourDeclaration,
  ServiceBehaviourInterface,
  ServiceDeclaration,
  ServiceFunctionDeclaration,
  ServiceInterface,
  ServiceMetadata,
  ServiceProxy,
} from './declaration.js';

// Registration types
export type {
  ModuleSpecifier,
  RegistryValue,
  ServiceRegistration,
  SliceRegistration,
} from './registration.js';
export { EMPTY_REGISTRY } from './registration.js';

// Transport
export type { Transport, TransportPair } from './transport.js';
export { createInProcessTransportPair } from './in-process-transport.js';
export { createWorkerTransport, type WorkerTransportOptions } from './worker-transport.js';

// Errors
export {
  FunctionNotDeclaredError,
  HostUnavailableError,
  PatchNotApplicableError,
  ReturnValidationError,
  RuntimeError,
  ServiceNotRegisteredError,
  SliceNotRegisteredError,
  StaleBasisError,
  ValidationError,
  deserialiseError,
  isRuntimeErrorSerialised,
  type RuntimeErrorSerialised,
} from './errors.js';

// RuntimeClient
export { RuntimeClient, type RuntimeClientOptions } from './runtime-client.js';

// ServiceHost
export { ServiceHost, type HostInterface } from './service-host.js';

// ServiceImplementation
export { ServiceImplementation, type HostContext } from './service-implementation.js';
export type { ServiceCallContext } from './service-call-context.js';

// ServiceBroker
export {
  ServiceBroker,
  InProcessHostSpawner,
  type ServiceModuleResolver,
  type HostSpawner,
  type RegistryUpdateCallback,
} from './service-broker.js';

// Runtime facade
export {
  Runtime,
  type RuntimeOptions,
  type BrokerFactory,
  type BrokerFactoryResult,
  createInProcessBrokerFactory,
  getRuntime,
  peekRuntime,
  resetRuntime,
} from './runtime.js';

// Worker spawner
export { WorkerHostSpawner, type WorkerHostSpawnerOptions } from './worker-host-spawner.js';

// Worker broker factory
export {
  createWorkerBrokerFactory,
  type WorkerBrokerFactoryOptions,
} from './worker-broker-factory.js';

// Worker protocol types
export type {
  BrokerWorkerInit,
  BrokerWorkerRegister,
  HostWorkerError,
  HostWorkerInit,
  HostWorkerReady,
  WorkerControlMessage,
  WorkerUrl,
} from './worker-protocol.js';

// State model
export type {
  Patch,
  SliceDeclaration,
  SliceDefinition,
  SliceMutationDeclaration,
} from './state-model.js';
export { defineSlice } from './state-model.js';

// Authority
export type { Ack, MutationParams, Snapshot } from './authority.js';
export { Authority } from './authority.js';

// Broadcast
export type {
  BroadcastChannelLike,
  PatchChannel,
  PatchChannelOptions,
  PatchMessage,
} from './broadcast.js';
export { createPatchChannel } from './broadcast.js';

// Local copy
export type { LocalCopy, LocalCopyOptions, SnapshotFetcher } from './local-copy.js';
export { createLocalCopy } from './local-copy.js';

// Store builder
export type { SliceStore, StoreBuilder } from './store-builder.js';
export { createStoreBuilder } from './store-builder.js';
