/**
 * The frontend entry point: imports the UI components, the worker host elements,
 * and mounts the <darkling-app>.
 *
 * @see specs/usage-and-deployment.spec.md#bootstrap-sequence
 */

import './ui/darkling-app.js';
import './ui/scene.js';
import './ui/document-tablet.js';
import './ui/non-document-tablet.js';
import './ui/guide-avatar.js';
import './ui/address-input.js';

// The service bus + state manager host elements.
import '@darkling/service-bus/lit';
import '@darkling/state-manager/lit';

import type { ServiceBusHostOptions } from '@darkling/service-bus/lit';
import type { StateManagerHostOptions } from '@darkling/state-manager/lit';

// The hosts are mounted in index.html wrapping <darkling-app> so that the app
// and the UI components consume the ServiceClient and the shared-state
// LocalCopy from ancestor providers (Lit context flows downward). Configure
// the hosts' options via their properties.
const busHost = document.querySelector('service-bus-host');
const stateHost = document.querySelector('state-manager-host');
if (busHost && stateHost) {
  const brokerWorkerUrl = new URL('./workers/broker-worker.ts', import.meta.url).href;
  const hostWorkerUrl = new URL('./workers/host-worker.ts', import.meta.url).href;

  // Service registrations: the module specifiers point to the re-export
  // modules that default-export each service declaration. The host worker
  // dynamically imports these by module specifier when activating services.
  const guideDeclarationUrl = new URL('./workers/guide-declaration.ts', import.meta.url).href;
  const retrievalDeclarationUrl = new URL('./workers/retrieval-declaration.ts', import.meta.url)
    .href;
  const stateManagerDeclarationUrl = new URL(
    './workers/state-manager-declaration.ts',
    import.meta.url,
  ).href;

  const busOptions: ServiceBusHostOptions = {
    brokerWorkerUrl,
    hostWorkerUrl,
    registrations: [
      {
        id: 'guide',
        moduleSpecifier: guideDeclarationUrl,
        // Serialisable construction config for the Guide worker. The worker
        // builds the HttpLlmProvider, ToolRegistry, and BudgetTracker from
        // these (see workers/guide-service.ts). The LLM proxy endpoint is the
        // backend's /llm/turn; the Service Worker attaches the bearer token.
        // The service-bus host worker keys these under the service ID, so the
        // Guide service reads them from hostContext.options.guide.
        options: { llmEndpoint: '/llm/turn' },
      },
      { id: 'knowledge-base', moduleSpecifier: retrievalDeclarationUrl },
      { id: 'state-manager', moduleSpecifier: stateManagerDeclarationUrl },
    ],
  };

  const stateOptions: StateManagerHostOptions = {
    slices: ['interface'],
    channelName: 'darkling-state',
  };

  // Set the options as reactive properties (not attributes) so Lit receives
  // the typed objects, not JSON strings.
  (busHost as unknown as { options: ServiceBusHostOptions }).options = busOptions;
  (stateHost as unknown as { options: StateManagerHostOptions }).options = stateOptions;
}

// Register the Service Worker for transparent token handling, as defined by
// [Usage and deployment](../../specs/usage-and-deployment.spec.md#service-worker).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(new URL('./sw.ts', import.meta.url), { type: 'module' })
      .catch(() => {
        // Service Worker registration failed; the app still works but token
        // handling falls back to direct fetch (without the bearer header).
      });
  });
}
