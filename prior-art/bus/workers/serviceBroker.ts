/// <reference lib="webworker" />

import { enablePatches } from "immer";
import { ServiceBroker } from "../ServiceBroker.js";

declare const __SERVICE_HOST_WORKER_PATH__: string;

enablePatches();

ServiceBroker.serviceHostWorkerUrl = __SERVICE_HOST_WORKER_PATH__;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _broker = new ServiceBroker(
  globalThis as unknown as DedicatedWorkerGlobalScope,
);
