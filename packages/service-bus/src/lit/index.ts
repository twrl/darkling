/**
 * @darkling/service-bus/lit — Lit integration for the service bus.
 *
 * This subpath exports a `<service-bus-host>` custom element that hosts the
 * `ServiceBus` facade and provides the `ServiceClient` to descendant elements
 * via Lit's context mechanism, along with a `@consumeServiceClient()` decorator
 * and `useServiceClient` hook for consumers.
 *
 * Lit and @lit/context are optional peer dependencies. Import this subpath
 * only in projects that use Lit.
 */

export { serviceClientContext } from './service-client-context.js';

export { consumeServiceClient, useServiceClient } from './consume-service-client.js';

export { ServiceBusHost, type ServiceBusHostOptions } from './service-bus-host.js';
