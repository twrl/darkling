/**
 * Configuration resolution: merge overrides over the default profile,
 * validate, and produce a `Config`.
 *
 * Implements the resolution order defined by the usage-and-deployment
 * specification: override takes precedence over the default profile;
 * an unresolved parameter (neither overridden nor in the default profile)
 * is a conformance failure. Invalid values are rejected and reported.
 */

import { defaultProfile } from './default-profile.js';
import { configSchema, type Config, type ConfigOverrides } from './types.js';

/**
 * Merge a partial override into a base value, producing a new object.
 * Shallow merge at the top level of each section: fields provided in the
 * override replace the base's fields; fields not provided in the override
 * retain the base's value.
 */
function mergeSection<T extends Record<string, unknown>>(
  base: T,
  override: Partial<T> | undefined,
): T {
  if (!override) return base;
  return { ...base, ...override };
}

/**
 * Resolve configuration by merging overrides over the default profile
 * and validating the result.
 *
 * @param overrides - Partial configuration providing overrides. Each
 *   section is optional, and within each section, fields are optional.
 *   Provided fields take precedence over the default profile.
 * @param base - The default profile to resolve against. Defaults to the
 *   system-wide `defaultProfile`.
 * @returns A validated `Config`.
 * @throws {ConfigResolutionError} If a resolved value fails validation
 *   or a required parameter is unresolved.
 */
export function resolveConfig(overrides?: ConfigOverrides, base?: Config): Config {
  const defaults = base ?? defaultProfile;

  const merged: Config = {
    content: mergeSection(defaults.content, overrides?.content),
    guide: mergeSection(defaults.guide, overrides?.guide),
    retrieval: mergeSection(defaults.retrieval, overrides?.retrieval),
    runtime: mergeSection(defaults.runtime, overrides?.runtime),
  };

  // Backend-only sections: include only if the default profile has them
  // or an override is provided. For frontend configs, these are absent.
  if (defaults.llm || overrides?.llm) {
    merged.llm = mergeSection(
      defaults.llm ?? ({} as Config['llm'] & {}),
      overrides?.llm,
    ) as Config['llm'];
  }

  if (defaults.stores || overrides?.stores) {
    merged.stores = mergeSection(
      defaults.stores ?? ({} as Config['stores'] & {}),
      overrides?.stores,
    ) as Config['stores'];
  }

  if (defaults.access || overrides?.access) {
    const baseAccess = defaults.access ?? ({} as Config['access'] & {});
    const accessOverride = overrides?.access;
    merged.access = {
      ...baseAccess,
      ...accessOverride,
      // Deep-merge tiers: per-tier overrides take precedence over default tiers
      tiers: {
        ...baseAccess.tiers,
        ...(accessOverride?.tiers ?? {}),
      },
    } as Config['access'];
  }

  return validateConfig(merged);
}

/**
 * Validate a config object against the `Config` Zod schema.
 *
 * @throws {ConfigResolutionError} If validation fails.
 */
export function validateConfig(config: unknown): Config {
  const result = configSchema.safeParse(config);
  if (result.success) {
    return Object.freeze(result.data) as Config;
  }

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `  ${path}: ${issue.message}`;
  });
  throw new ConfigResolutionError(
    `Configuration validation failed:\n${issues.join('\n')}`,
    result.error,
  );
}

/**
 * Error thrown when configuration resolution fails.
 */
export class ConfigResolutionError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ConfigResolutionError';
    this.cause = cause;
  }
}
