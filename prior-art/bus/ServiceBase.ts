/// <reference lib="webworker" />

import { z, type ZodObject } from "zod";

import type { AnyMessageEnvelope } from "./Messages.js";
import type {
  ServiceSpecification,
  ServiceSupport,
  ServiceImplementation,
} from "./ServiceTypes.js";

export abstract class ServiceBase<
  Spec extends ServiceSpecification = ServiceSpecification,
> implements ServiceImplementation {
  #spec: Spec;
  #host: ServiceSupport;

  constructor(spec: Spec, host: ServiceSupport) {
    this.#spec = spec;
    this.#host = host;
  }

  get serviceId() {
    return this.#spec.name;
  }

  get state() {
    return this.host.state;
  }

  get host() {
    return this.#host;
  }

  async handleMessage(message: AnyMessageEnvelope): Promise<unknown> {
    if (!(message.head.msg in this.#spec.methods)) return undefined;

    const resultValidator = this.#spec.methods[message.head.msg]
      .result as ZodObject;
    const paramValidator = this.#spec.methods[message.head.msg]
      .param as ZodObject;

    const param = await paramValidator.safeParseAsync(message.body);
    if (!param.success) return undefined;

    try {
      // @ts-expect-error "It's not trivial to index into this using message.head.msg"
      const ret = await this[message.head.msg](param.data);
      const result = await resultValidator.safeParseAsync(ret);
      if (result.success) {
        this.#host.postMessage({
          head: {
            src: this.serviceId,
            dst: message.head.src,
            mid: message.head.mid,
            msg: "return",
          },
          body: result.data,
        });
      }
      return result.data;
    } catch (e) {
      const error = await z.instanceof(Error).parseAsync(e);
      this.#host.postMessage({
        head: {
          src: this.serviceId,
          dst: message.head.src,
          mid: message.head.mid,
          msg: "error",
        },
        body: {
          error,
        },
      });
      return undefined;
    }
  }

  async callRemote(message: AnyMessageEnvelope): Promise<unknown> {
    return await this.#host.callRemote(message);
  }

  // useService(name: keyof typeof serviceCatalog) {
  //   return this.host.createServiceProxy(serviceCatalog[name], this.serviceId);
  // }
}
