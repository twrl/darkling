/**
 * Fluent configuration builder API.
 *
 * The `ConfigBuilder` accumulates overrides via fluent methods, one per
 * config section. When `build()` is called, the overrides are resolved
 * against the default profile, validated, and a `Config` is produced.
 *
 * @example
 * ```ts
 * import { createConfigBuilder } from '@darkling/configurator';
 *
 * const config = await createConfigBuilder()
 *   .content({
 *     source: { type: 'git', url: 'https://github.com/me/my-world' },
 *     guideDefinition: { voice: 'You are a wise and ancient archivist.' },
 *   })
 *   .guide({ budgetPolicy: { base: 15 } })
 *   .retrieval({ defaultResultLimit: 50 })
 *   .frontend()
 *   .build();
 * ```
 */

import { defaultProfile } from './default-profile.js';
import { resolveConfig } from './resolve.js';
import type {
  AccessConfig,
  Config,
  ConfigOverrides,
  ContentConfig,
  GuideConfig,
  LlmConfig,
  RetrievalConfig,
  RuntimeConfig,
  StoresConfig,
  TierName,
  TierPolicy,
} from './types.js';

export class ConfigBuilder {
  private readonly overrides: ConfigOverrides = {};
  private _frontend = false;

  /**
   * Set or override the `content` section.
   * Fields not provided retain the default profile's value.
   */
  content(content: Partial<ContentConfig>): this {
    this.overrides.content = { ...this.overrides.content, ...content };
    return this;
  }

  /**
   * Set or override the `llm` section (backend-only).
   * Excluded from the resolved config if `frontend()` was called.
   */
  llm(llm: Partial<LlmConfig>): this {
    this.overrides.llm = { ...this.overrides.llm, ...llm };
    return this;
  }

  /**
   * Set or override the `stores` section (backend-only).
   * Excluded from the resolved config if `frontend()` was called.
   */
  stores(stores: Partial<StoresConfig>): this {
    this.overrides.stores = { ...this.overrides.stores, ...stores };
    return this;
  }

  /**
   * Set or override the `access` section (backend-only).
   * Excluded from the resolved config if `frontend()` was called.
   *
   * The `tiers` field accepts a partial record: individual tier overrides
   * take precedence over the default profile's tiers.
   */
  access(
    access: Partial<Omit<AccessConfig, 'tiers'>> & {
      tiers?: Partial<Record<TierName, TierPolicy>>;
    },
  ): this {
    this.overrides.access = { ...this.overrides.access, ...access };
    return this;
  }

  /**
   * Set or override the `guide` section (constrained-agent policy parameters).
   * Fields not provided retain the default profile's value.
   */
  guide(guide: Partial<GuideConfig>): this {
    this.overrides.guide = { ...this.overrides.guide, ...guide };
    return this;
  }

  /**
   * Set or override the `retrieval` section (retrieval policy parameters).
   * Fields not provided retain the default profile's value.
   */
  retrieval(retrieval: Partial<RetrievalConfig>): this {
    this.overrides.retrieval = { ...this.overrides.retrieval, ...retrieval };
    return this;
  }

  /**
   * Set or override the `runtime` section (runtime policy parameters).
   * Fields not provided retain the default profile's value.
   */
  runtime(runtime: Partial<RuntimeConfig>): this {
    this.overrides.runtime = { ...this.overrides.runtime, ...runtime };
    return this;
  }

  /**
   * Mark this builder as producing a frontend configuration.
   * The resolved `Config` will exclude `llm`, `stores`, and `access` sections.
   */
  frontend(): this {
    this._frontend = true;
    return this;
  }

  /**
   * Resolve the accumulated overrides against the default profile,
   * validate, and return a `Config`.
   *
   * @throws {ConfigResolutionError} If a resolved value fails validation
   *   or a required parameter is unresolved.
   */
  build(): Config {
    const base: Config = this._frontend ? stripBackendSections(defaultProfile) : defaultProfile;

    const overrides = this._frontend ? stripBackendOverrides(this.overrides) : this.overrides;

    return resolveConfig(overrides, base);
  }
}

/**
 * Create a new `ConfigBuilder`.
 */
export function createConfigBuilder(): ConfigBuilder {
  return new ConfigBuilder();
}

// ---------------------------------------------------------------------------

function stripBackendSections(config: Config): Config {
  const rest: Record<string, unknown> = { ...config };
  delete rest.llm;
  delete rest.stores;
  delete rest.access;
  return rest as Config;
}

function stripBackendOverrides(overrides: ConfigOverrides): ConfigOverrides {
  const rest: Record<string, unknown> = { ...overrides };
  delete rest.llm;
  delete rest.stores;
  delete rest.access;
  return rest as ConfigOverrides;
}
