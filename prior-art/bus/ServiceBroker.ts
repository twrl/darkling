/* eslint-disable @typescript-eslint/no-explicit-any -- bus infrastructure uses dynamic dispatch */
/// <reference lib="webworker" />

import { type ServiceHostServiceInterface } from "../services/ServiceHostService.def.js";
import { applyPatches, produceWithPatches } from "immer";
import { Signal } from "./Signal.js";
import {
  stateSchema,
  stateUpdateMessageEnv,
  type State,
} from "./GlobalState.js";
import { anyMessage, type AnyMessageEnvelope } from "./Messages.js";
import { serviceCatalog } from "./ServiceCatalog.js";
import type {
  ServiceImplementation,
  ServiceInterface,
  ServiceSpecification,
  ServiceSupport,
} from "./ServiceTypes.js";

import { busLog } from "../lib/logger.js";

export class ServiceBroker implements ServiceSupport {
  #global: DedicatedWorkerGlobalScope;
  #hosts: Map<symbol, Worker>;
  #hostsReverse: WeakMap<EventTarget, symbol>;
  #services: Map<string, symbol>;
  #hostQueues: WeakMap<Worker, AnyMessageEnvelope[]>;
  #serviceHostServices: WeakMap<Worker, ServiceHostServiceInterface>;
  #calls: Map<string, [(value: any) => void, (error: any) => void]>;
  #hostRequests: Map<string, symbol>;

  #localServices: Map<string, ServiceImplementation>;

  constructor(global: DedicatedWorkerGlobalScope) {
    this.#global = global;
    this.#hosts = new Map();
    this.#hostsReverse = new WeakMap();
    this.#services = new Map();
    this.#localServices = new Map();
    this.#hostQueues = new WeakMap();
    this.#serviceHostServices = new WeakMap();

    this.#stateUpdateChannel = new BroadcastChannel("state_update");
    this.#state = new Signal(stateSchema.parse({}));
    this.#stateUpdateChannel.addEventListener("message", (ev) => {
      const { success, data } = stateUpdateMessageEnv.safeParse(ev.data);
      if (success) {
        this.#state.value = applyPatches(this.#state.value, data.body.patches);
      }
    });

    this.#calls = new Map();
    this.#hostRequests = new Map();

    Promise.allSettled(
      Object.values(serviceCatalog).map(async (spec) => {
        if (spec.colocation === "broker") {
          await this.#activateLocalService(spec.name);
        }
      }),
    ).then(() => {
      this.#global.addEventListener("message", this.#onmessage.bind(this));
      this.#global.postMessage({
        head: { src: "broker", dst: "main", msg: "ready", mid: "" },
        body: null,
      } satisfies AnyMessageEnvelope);
    });
  }

  async #activateLocalService(name: string): Promise<void> {
    const spec = serviceCatalog[name];
    if (spec?.loader) {
      busLog.info(`activating ${name} (local)`);
      const { default: Svc } = await spec.loader();
      this.#localServices.set(name, new Svc(this));
    }
  }

  #state: Signal<State>;
  #stateUpdateChannel: BroadcastChannel;
  get state(): Signal<State> {
    return this.#state;
  }

  /** URL for the service host worker. Set before constructing. */
  static serviceHostWorkerUrl: string | URL = "";

  async spawnHost(): Promise<symbol> {
    const hostId = Symbol();
    const hostWorker = new Worker(ServiceBroker.serviceHostWorkerUrl, {
      type: "module",
    });
    hostWorker.addEventListener("message", this.#onmessage.bind(this));
    this.#hosts.set(hostId, hostWorker);
    this.#hostsReverse.set(hostWorker, hostId);
    this.#hostQueues.set(hostWorker, []);
    this.#serviceHostServices.set(
      hostWorker,
      this.createServiceHostServiceProxy(hostId),
    );

    return hostId;
  }

  async postMessageToHost(
    host: symbol,
    message: AnyMessageEnvelope,
  ): Promise<void> {
    const hostWorker = this.#hosts.get(host);
    if (hostWorker) {
      const queue = this.#hostQueues.get(hostWorker);
      if (queue) queue.push(message);
      queueMicrotask(this.#processQueue.bind(this));
    }
  }

  async postMessageToService(message: AnyMessageEnvelope): Promise<void> {
    const hostId = this.#services.get(message.head.dst);
    if (hostId) {
      await this.postMessageToHost(hostId, message);
    } else throw new Error(`No Service Host known for ${message.head.dst}`);
  }

  async activateServiceOnHost(
    host: symbol,
    serviceName: string,
  ): Promise<void> {
    if (this.#hosts.has(host)) {
      const mid = crypto.randomUUID();
      await this.callOnHost(host, {
        head: {
          src: "broker",
          dst: "ServiceHostService",
          msg: "activate",
          mid,
        },
        body: { name: serviceName },
      });
    }
  }

  async activateService(name: string): Promise<void> {
    const spec = serviceCatalog[name];
    if (!spec) return;

    if (spec.colocation === "broker") {
      await this.#activateLocalService(spec.name);
    } else if (
      Array.isArray(spec.colocation) &&
      spec.colocation.some((c) => this.#services.has(c))
    ) {
      const colocateWith = Array.from(this.#services.keys()).find((k) =>
        (spec.colocation as string[]).includes(k),
      );
      const h = colocateWith
        ? this.#services.get(colocateWith)!
        : await this.spawnHost();
      await this.activateServiceOnHost(h, name);
      this.#services.set(name, h);
    } else {
      const h = await this.spawnHost();
      await this.activateServiceOnHost(h, name);
      this.#services.set(name, h);
    }
  }

  async postMessage(message: AnyMessageEnvelope): Promise<void> {
    // Resolve pending callRemote/callOnHost promises for return/error messages.
    if (
      (message.head.msg === "return" || message.head.msg === "error") &&
      this.#calls.has(message.head.mid)
    ) {
      const [resolve, reject] = this.#calls.get(message.head.mid)!;
      this.#calls.delete(message.head.mid);
      if (message.head.msg === "return") {
        resolve(message.body);
      } else {
        reject(message.body);
      }
      return;
    }

    if (message.head.dst === "main") {
      this.#global.postMessage(
        message,
        (message.head.xfr ?? []) as Transferable[],
      );
    } else if (message.head.dst === "host") {
      const dst = this.#hostRequests.get(message.head.mid);
      if (dst) {
        this.#hostRequests.delete(message.head.mid);
        await this.postMessageToHost(dst, message);
      }
    } else if (this.#localServices.has(message.head.dst)) {
      await this.#localServices.get(message.head.dst)!.handleMessage(message);
    } else {
      if (!this.#services.has(message.head.dst)) {
        await this.activateService(message.head.dst);
      }
      await this.postMessageToService(message);
    }
  }

  async #onmessage(event: MessageEvent): Promise<void> {
    const { success, data: message } = await anyMessage.safeParseAsync(
      event.data,
    );

    if (success) {
      if (message.head.msg !== "return" && message.head.msg !== "error") {
        busLog.info(
          `${message.head.dst}.${message.head.msg} ← ${message.head.src}`,
        );
      }
      busLog.debug(message);
      // Track which host sent this so return messages can be routed back.
      if (message.head.src === "host") {
        this.#hostRequests.set(
          message.head.mid,
          this.#hostsReverse.get(event.target!)!,
        );
      }
      // postMessage handles call resolution, local dispatch, and routing.
      await this.postMessage(message);
    }
  }

  callOnHost(host: symbol, message: AnyMessageEnvelope): Promise<any> {
    const mid = crypto.randomUUID();
    message.head.mid = mid;

    return new Promise((resolve, reject) => {
      this.postMessageToHost(host, message);
      this.#calls.set(mid, [resolve, reject]);
    });
  }

  callRemote(message: AnyMessageEnvelope): Promise<any> {
    const mid = crypto.randomUUID();
    message.head.mid = mid;

    return new Promise((resolve, reject) => {
      this.postMessage(message);
      this.#calls.set(mid, [resolve, reject]);
      setTimeout(() => this.#processQueue(), 0);
    });
  }

  #processQueue(): void {
    for (const [, hostWorker] of this.#hosts) {
      let queue = this.#hostQueues.get(hostWorker);
      if (!queue) {
        queue = [];
        this.#hostQueues.set(hostWorker, queue);
      }
      while (queue.length > 0) {
        const message = queue.shift()!;
        queueMicrotask(() => {
          hostWorker.postMessage(
            message,
            (message.head.xfr ?? []) as Transferable[],
          );
        });
      }
    }
  }

  createServiceHostServiceProxy(host: symbol): ServiceHostServiceInterface {
    const methods = serviceCatalog["ServiceHostService"]?.methods ?? {};
    return Object.fromEntries(
      Object.entries(methods).map(
        ([name, validators]: [string, { param: any; result: any }]) => [
          name,
          async (p: any) => {
            await this.callOnHost(host, {
              head: {
                src: "broker",
                dst: "ServiceHostService",
                msg: name,
                mid: "",
              },
              body: await validators.param.parseAsync(p),
            });
          },
        ],
      ),
    ) as unknown as ServiceHostServiceInterface;
  }

  createServiceProxy<Spec extends ServiceSpecification>(
    spec: Spec,
    src: string,
  ): ServiceInterface<Spec> {
    return Object.fromEntries(
      Object.entries(spec.methods).map(
        ([name, validators]: [string, { param: any; result: any }]) => [
          name,
          (async (param: any) => {
            return this.callRemote({
              head: { src, dst: spec.name, msg: name, mid: "" },
              body: await validators.param.parseAsync(param),
            });
          }).bind(this),
        ],
      ),
    ) as ServiceInterface<Spec>;
  }

  useService(
    name: keyof typeof serviceCatalog,
  ): ServiceInterface<ServiceSpecification> {
    return this.createServiceProxy(serviceCatalog[name], "broker");
  }

  async updateGlobalState(rx: (draft: State) => State | void): Promise<void> {
    const [, patches, reversePatches] = produceWithPatches(
      this.state.value,
      rx,
    );
    await this.useService("StateManagerService").update({
      patches,
      reversePatches,
    });
  }
}
