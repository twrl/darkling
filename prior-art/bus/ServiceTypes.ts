import type { Signal } from "./Signal.js";
import type { State } from "./GlobalState.js";
import type { AnyMessageEnvelope } from "./Messages.js";
import type { z } from "zod";
import type { serviceCatalog } from "./ServiceCatalog.js";

/** A Zod schema slot — constrains to any ZodType while preserving inference. */
type AnyZodSchema = z.ZodType;

export type ServiceSpecification = {
  name: string;
  colocation?: "broker" | false | readonly string[];
  module?: string;
  loader?: () => Promise<{
    default: new (host: ServiceSupport) => ServiceImplementation;
  }>;
  methods: Record<string, { param: AnyZodSchema; result: AnyZodSchema }>;
};

export const spec = (s: ServiceSpecification) => s;

/**
 * Maps a ServiceSpecification to a typed async interface.
 * Each method becomes `(param: z.infer<ParamSchema>) => Promise<z.infer<ResultSchema>>`.
 */
export type ServiceInterface<Spec extends Readonly<ServiceSpecification>> = {
  [K in keyof Spec["methods"]]: (
    param: z.infer<Spec["methods"][K]["param"]>,
  ) => Promise<z.infer<Spec["methods"][K]["result"]>>;
};

/** Base type for service implementations (avoids `any` in loader). */
export interface ServiceImplementation {
  handleMessage(message: AnyMessageEnvelope): Promise<unknown>;
}

export interface ServiceSupport {
  postMessage(message: AnyMessageEnvelope): Promise<void>;
  callRemote(message: AnyMessageEnvelope): Promise<unknown>;
  createServiceProxy<Spec extends ServiceSpecification>(
    spec: Spec,
    src: string,
  ): ServiceInterface<Spec>;
  state: Signal<State>;
  updateGlobalState(rx: (draft: State) => State | void): Promise<void>;
  useService(
    name: keyof typeof serviceCatalog,
  ): ServiceInterface<ServiceSpecification>;
}
