/**
 * The host worker entry point for the frontend.
 *
 * Re-exports the generic service-bus host worker, which dynamically imports
 * service declaration modules and activates them. The broker sends a
 * `HostWorkerInit` message specifying which services to activate (by module
 * specifier); this worker imports each declaration and starts the host.
 *
 * @see specs/service-bus.spec.md#worker-topology
 */

import '@darkling/service-bus/src/host-worker.js';
