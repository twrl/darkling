/**
 * The broker worker entry point for the frontend.
 *
 * Re-exports the generic service-bus broker worker, which handles service
 * registrations and routes envelopes between the main-thread ServiceClient
 * and host workers.
 *
 * @see specs/service-bus.spec.md#worker-topology
 */

import '@darkling/service-bus/broker-worker';
