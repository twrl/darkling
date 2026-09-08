/**
 * Darkling instance loading.
 *
 * A Darkling instance corresponds to a CommonJS package with
 * `{ "type": "module" }` where:
 *
 * - the package exports a named entry point `./darkling-config` which is a
 *   module;
 * - that module has a default export which is a `Config`, a `ConfigBuilder`,
 *   a `Promise` for either of them, or a synchronous or asynchronous factory
 *   function that produces one of them.
 *
 * A Darkling instance may contain content, or may configure an external git
 * repository as a content source.
 *
 * The `loadInstance` function loads a Darkling instance from its package's
 * `./darkling-config` entry point, resolving the various export forms into
 * a `Config`.
 */

import type { Config } from './types.js';
import type { ConfigBuilder } from './builder.js';

/**
 * A function that produces a Config, ConfigBuilder, or a Promise for either.
 */
export type ConfigFactory =
  | (() => Config | ConfigBuilder | Promise<Config | ConfigBuilder>)
  | (() => Promise<Config | ConfigBuilder>);

/**
 * The accepted forms of a darkling-config module's default export.
 */
export type DarklingConfigExport =
  Config | ConfigBuilder | Promise<Config | ConfigBuilder> | ConfigFactory;

/**
 * Options for `loadInstance`.
 */
export interface LoadInstanceOptions {
  /**
   * The module specifier for the instance package's `./darkling-config`
   * entry point. This may be a bare specifier (e.g. `my-darkling-instance`)
   * or a path (e.g. `./darkling-config`).
   *
   * If the specifier does not include `/darkling-config`, the suffix is
   * appended automatically.
   */
  moduleSpecifier: string;
}

/**
 * Load a Darkling instance from its package's `./darkling-config` entry point.
 *
 * Resolves the various export forms (Config, ConfigBuilder, Promise, factory)
 * into a resolved `Config`.
 *
 * @param options - The loading options.
 * @returns A resolved `Config`.
 * @throws {InstanceLoadError} If the module cannot be loaded, the export does
 *   not conform to any accepted form, or resolution fails.
 *
 * @example
 * ```ts
 * import { loadInstance } from '@darkling/configurator';
 *
 * const config = await loadInstance({
 *   moduleSpecifier: 'my-darkling-instance',
 * });
 * ```
 */
export async function loadInstance(options: LoadInstanceOptions): Promise<Config> {
  const specifier = resolveModuleSpecifier(options.moduleSpecifier);

  let module: { default?: unknown };
  try {
    module = await import(specifier);
  } catch (cause) {
    throw new InstanceLoadError(
      `Failed to import darkling-config module "${specifier}": ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  }

  if (module.default === undefined || module.default === null) {
    throw new InstanceLoadError(`darkling-config module "${specifier}" has no default export`);
  }

  const config = await resolveExport(module.default, specifier);
  return config;
}

/**
 * Resolve a darkling-config default export into a `Config`.
 *
 * Handles: Config, ConfigBuilder, Promise<Config | ConfigBuilder>,
 * sync factory, async factory.
 */
async function resolveExport(exportValue: unknown, specifier: string): Promise<Config> {
  // Unwrap promises (top-level or from a factory call)
  let value: unknown = exportValue;
  if (value instanceof Promise) {
    value = await value;
  }

  // Factory function: call it to get Config | ConfigBuilder | Promise<either>
  if (typeof value === 'function') {
    try {
      value = (value as () => unknown)();
    } catch (cause) {
      throw new InstanceLoadError(
        `darkling-config factory in "${specifier}" threw: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      );
    }
    if (value instanceof Promise) {
      value = await value;
    }
  }

  // ConfigBuilder: call build()
  if (isConfigBuilder(value)) {
    try {
      value = value.build();
    } catch (cause) {
      throw new InstanceLoadError(
        `ConfigBuilder.build() in "${specifier}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      );
    }
  }

  // Final result must be a Config
  if (isConfig(value)) {
    return value;
  }

  throw new InstanceLoadError(
    `darkling-config module "${specifier}" default export must be a Config, ConfigBuilder, Promise for either, or a factory function producing one of them. Got: ${describeType(value)}`,
  );
}

/**
 * Ensure the module specifier points to the `darkling-config` subpath.
 *
 * If the specifier already ends in `darkling-config` (with or without a
 * file extension), it is used as-is. Otherwise, `/darkling-config` is
 * appended — this is the convention for a Darkling instance package's
 * named export.
 */
function resolveModuleSpecifier(specifier: string): string {
  // Already ends with /darkling-config or is darkling-config
  if (specifier.endsWith('/darkling-config') || specifier === 'darkling-config') {
    return specifier;
  }

  // Ends with darkling-config.<ext> — a direct file path to the entry point
  if (/\/darkling-config\.[a-z]+$/i.test(specifier)) {
    return specifier;
  }

  // Bare specifier like 'my-instance' → 'my-instance/darkling-config'
  // Relative/absolute path like './config' → './config/darkling-config'
  return `${specifier}/darkling-config`;
}

/**
 * Duck-type a ConfigBuilder: has a `build()` method that returns a Config.
 */
function isConfigBuilder(value: unknown): value is ConfigBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ConfigBuilder).build === 'function'
  );
}

/**
 * Duck-type a Config: has the expected top-level sections.
 * A full validation is deferred to the consumer; here we just check shape.
 */
function isConfig(value: unknown): value is Config {
  return (
    typeof value === 'object' &&
    value !== null &&
    'content' in value &&
    'guide' in value &&
    'retrieval' in value &&
    'runtime' in value
  );
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return typeof value;
}

/**
 * Error thrown when instance loading fails.
 */
export class InstanceLoadError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'InstanceLoadError';
    this.cause = cause;
  }
}
