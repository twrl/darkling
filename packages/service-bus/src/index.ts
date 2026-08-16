/**
 * @darkling/service-bus — the service bus: the communication substrate by
 * which services running across Web Workers are activated on demand and
 * invoked through message passing.
 *
 * @see specs/service-bus.spec.md
 */

export type {
  Envelope,
  EnvelopeHead,
  FunctionName,
  MessageId,
  MessageType,
  ServiceId,
  TransferableRef,
} from './envelope.js';

export type {
  ServiceDeclaration,
  ServiceFunctionDeclaration,
  ServiceInterface,
  ServiceMetadata,
} from './declaration.js';

export type { Transport, TransportPair } from './transport.js';

export { createInProcessTransportPair } from './in-process-transport.js';

export { createWorkerTransport, type WorkerTransportOptions } from './worker-transport.js';

export {
  ServiceBusError,
  ReturnValidationError,
  ValidationError,
  HostUnavailableError,
  ServiceNotRegisteredError,
  FunctionNotDeclaredError,
  deserialiseError,
  isServiceBusErrorSerialised,
  type ServiceBusErrorSerialised,
} from './errors.js';

export { ServiceClient, type ServiceClientOptions } from './service-client.js';

export { ServiceHost } from './service-host.js';

export { ServiceImplementation, type HostContext } from './service-implementation.js';

export type { ServiceCallContext } from './service-call-context.js';

export {
  ServiceBroker,
  InProcessHostSpawner,
  type ServiceModuleResolver,
} from './service-broker.js';

export type { HostSpawner, HostLaunchRequest, LaunchedHost } from './host-spawner.js';

export {
  ServiceModuleRegistry,
  type ServiceRegistration,
  type ModuleSpecifier,
} from './service-module-registry.js';

export {
  ServiceBus,
  type ServiceBusOptions,
  type BrokerFactory,
  type BrokerFactoryResult,
  createInProcessBrokerFactory,
  getServiceBus,
  peekServiceBus,
  resetServiceBus,
} from './service-bus.js';

export { WorkerHostSpawner, type WorkerHostSpawnerOptions } from './worker-host-spawner.js';

export {
  createWorkerBrokerFactory,
  type WorkerBrokerFactoryOptions,
} from './worker-broker-factory.js';

export type {
  BrokerWorkerInit,
  BrokerWorkerRegister,
  HostWorkerInit,
  HostWorkerReady,
  HostWorkerError,
  WorkerControlMessage,
  WorkerUrl,
} from './worker-protocol.js';
