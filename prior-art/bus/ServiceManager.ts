/* eslint-disable @typescript-eslint/no-explicit-any -- bus infrastructure uses dynamic dispatch */
import { enablePatches, applyPatches } from "immer";
import {
  stateSchema,
  stateUpdateMessageEnv,
  type State,
} from "./GlobalState.js";
import { anyMessage, type AnyMessageEnvelope } from "./Messages.js";
import { serviceCatalog } from "./ServiceCatalog.js";
import { Signal } from "./Signal.js";
import type { ServiceInterface, ServiceSpecification } from "./ServiceTypes.js";

enablePatches();

export class ServiceManager {
  #broker: Worker;
  #calls: Map<string, [(value: any) => void, (error: any) => void]>;
  #outboundQueue: AnyMessageEnvelope[];
  #dispatching = false;
  #state: Signal<State>;
  #stateUpdateChannel: BroadcastChannel;

  static #instance?: ServiceManager;

  /** URL for the broker worker. Must be set before first access to .instance. */
  static brokerWorkerUrl: string | URL = "";

  static get instance(): ServiceManager {
    if (!ServiceManager.#instance) {
      ServiceManager.#instance = new ServiceManager();
    }
    return ServiceManager.#instance;
  }

  get serviceId(): string {
    return "main";
  }

  /** Shared application state, kept in sync via BroadcastChannel. */
  get state(): Signal<State> {
    return this.#state;
  }

  private constructor() {
    this.#broker = new Worker(ServiceManager.brokerWorkerUrl, {
      type: "module",
    });
    this.#outboundQueue = [];
    this.#calls = new Map();

    this.#state = new Signal(stateSchema.parse({}));
    this.#stateUpdateChannel = new BroadcastChannel("state_update");
    this.#stateUpdateChannel.addEventListener("message", (ev) => {
      const { success, data } = stateUpdateMessageEnv.safeParse(ev.data);
      if (success) {
        this.#state.value = applyPatches(this.#state.value, data.body.patches);
      }
    });

    this.#broker.addEventListener(
      "message",
      (e) => {
        if (e.data?.head?.msg === "ready") {
          this.#broker.addEventListener("message", this.#onmessage.bind(this));
          this.#dispatching = true;
        }
      },
      { once: true },
    );
  }

  async #onmessage(event: MessageEvent): Promise<void> {
    const { success, data: message } = await anyMessage.safeParseAsync(
      event.data,
    );
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
      } else {
        throw new Error(`Unexpected message: ${JSON.stringify(message)}`);
      }
    }
  }

  callRemote(message: AnyMessageEnvelope): Promise<any> {
    const mid = crypto.randomUUID();
    message.head.mid = mid;
    return new Promise((resolve, reject) => {
      this.#outboundQueue.push(message);
      queueMicrotask(this.#processQueue.bind(this));
      this.#calls.set(mid, [resolve, reject]);
    });
  }

  #processQueue(): void {
    if (this.#dispatching) {
      while (this.#outboundQueue.length > 0) {
        const msg = this.#outboundQueue.shift()!;
        queueMicrotask(() =>
          this.#broker.postMessage(msg, (msg.head.xfr ?? []) as Transferable[]),
        );
      }
    } else {
      setTimeout(this.#processQueue.bind(this), 200);
    }
  }

  createServiceProxy<Spec extends ServiceSpecification>(
    spec: Spec,
  ): ServiceInterface<Spec> {
    return Object.fromEntries(
      Object.entries(spec.methods).map(
        ([name, validators]: [string, { param: any; result: any }]) => [
          name,
          (async (param: any) => {
            return this.callRemote({
              head: {
                src: this.serviceId,
                dst: spec.name,
                msg: name,
                mid: "",
              },
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
    return this.createServiceProxy(serviceCatalog[name]);
  }
}
