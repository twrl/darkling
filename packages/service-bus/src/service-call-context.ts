/**
 * Context provided to a service function when it is invoked by the
 * `ServiceHost`. This is the per-call context, distinct from the
 * {@link HostContext} provided to the implementation's constructor.
 *
 * @see specs/service-bus.spec.md#service-interface-contract
 */
export interface ServiceCallContext {
  /** The ID of the service being invoked. */
  serviceId: string;
  /** The name of the function being invoked. */
  functionName: string;
  /** The message ID of the call. */
  messageId: string;
}
