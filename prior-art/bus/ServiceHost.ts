/* eslint-disable @typescript-eslint/no-explicit-any -- bus infrastructure uses dynamic dispatch */
/// <reference lib="webworker" />

import ServiceHostService from "../services/ServiceHostService.js";
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

export class ServiceHost implements ServiceSupport {
  #services: Map<string, ServiceImplementation>;
  #global: DedicatedWorkerGlobalScope;
  #calls: Map<string, [(value: any) => void, (error: any) => void]>;

  #state: Signal<State>;
  #stateUpdateChannel: BroadcastChannel;

  get state(): Signal<State> {
    return this.#state;
  }

  constructor(globalScope: DedicatedWorkerGlobalScope) {
    this.#global = globalScope;
    this.#services = new Map();
    this.#calls = new Map();
    this.#stateUpdateChannel = new BroadcastChannel("state_update");
    this.#services.set("ServiceHostService", new ServiceHostService(this));
    this.#global.addEventListener("message", this.#onmessage.bind(this));

    this.#state = new Signal(stateSchema.parse({}));
    this.#stateUpdateChannel.addEventListener("message", (ev) => {
      const { success, data } = stateUpdateMessageEnv.safeParse(ev.data);
      if (success) {
        this.#state.value = applyPatches(this.#state.value, data.body.patches);
      }
    });
    this.useService("StateManagerService")
      .fetch({})
      .then((state: unknown) => {
        const r = stateSchema.safeParse(state);
        if (r.success) this.#state.value = r.data;
      });
  }

  async #onmessage(event: MessageEvent): Promise<void> {
    const { success, data: message } = await anyMessage.safeParseAsync(
      event.data,
    );

    busLog.debug(message);

    if (success) {
      if (message.head.msg === "return") {
        if (this.#calls.has(message.head.mid)) {
          const [resolve] = this.#calls.get(message.head.mid)!;
          resolve(message.body);
          this.#calls.delete(message.head.mid);
        }
      } else if (message.head.msg === "error") {
        if (this.#calls.has(message.head.mid)) {
          const [, reject] = this.#calls.get(message.head.mid)!;
          reject(message.body);
          this.#calls.delete(message.head.mid);
        }
      } else if (this.#services.has(message.head.dst)) {
        await this.#services.get(message.head.dst)!.handleMessage(message);
      }
    }
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

  callRemote(message: AnyMessageEnvelope): Promise<any> {
    const mid = crypto.randomUUID();
    message.head.mid = mid;
    return new Promise((resolve, reject) => {
      this.postMessage(message);
      this.#calls.set(mid, [resolve, reject]);
    });
  }

  async postMessage(message: AnyMessageEnvelope): Promise<void> {
    if (this.#services.has(message.head.dst)) {
      await this.#services.get(message.head.dst)!.handleMessage(message);
    } else {
      this.#global.postMessage(
        message,
        (message.head.xfr ?? []) as Transferable[],
      );
    }
  }

  async activate(name: string): Promise<void> {
    if (this.#services.has(name)) return;

    const spec = serviceCatalog[name];
    if (spec?.loader) {
      busLog.info(`activating ${name}`);
      const { default: Svc } = await spec.loader();
      this.#services.set(name, new Svc(this));
    }
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
    return this.createServiceProxy(serviceCatalog[name], "host");
  }

  async deactivate(name: string): Promise<void> {
    this.#services.delete(name);
  }
}
