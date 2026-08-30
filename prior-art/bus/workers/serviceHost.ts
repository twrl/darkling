/// <reference lib="webworker" />

import { enablePatches } from "immer";
import { ServiceHost } from "../ServiceHost.js";

enablePatches();

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _host = new ServiceHost(
  globalThis as unknown as DedicatedWorkerGlobalScope,
);
