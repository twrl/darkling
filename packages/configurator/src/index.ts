/**
 * `@darkling/configurator` — configuration model, fluent builder, default
 * profile, resolution, and Darkling instance loading.
 *
 * This package provides the developer-facing configuration API for assembling
 * a Darkling instance, as defined by the usage-and-deployment specification.
 *
 * @example
 * ```ts
 * import { createConfigBuilder, loadInstance } from '@darkling/configurator';
 *
 * // Build a config fluently
 * const config = createConfigBuilder()
 *   .content({ source: { type: 'git', url: 'https://github.com/me/world' } })
 *   .guide({ budgetPolicy: { base: 15 } })
 *   .frontend()
 *   .build();
 *
 * // Load an instance from its darkling-config entry point
 * const instanceConfig = await loadInstance({
 *   moduleSpecifier: 'my-darkling-instance',
 * });
 * ```
 */

// Types and schemas
export {
  configSchema,
  contentConfigSchema,
  llmConfigSchema,
  storesConfigSchema,
  accessConfigSchema,
  guideConfigSchema,
  retrievalConfigSchema,
  runtimeConfigSchema,
  guideDefinitionSchema,
  budgetPolicySchema,
  propertySchemaSchema,
  contentSourceSchema,
  tierPolicySchema,
  tierNameSchema,
  matchSemanticsSchema,
} from './types.js';

export type {
  Config,
  ConfigOverrides,
  ContentConfig,
  ContentSource,
  LlmConfig,
  LlmProviderName,
  StoresConfig,
  AccessConfig,
  TierName,
  TierPolicy,
  GuideConfig,
  BudgetPolicy,
  RetrievalConfig,
  RuntimeConfig,
  GuideDefinition,
  PropertySchema,
  RelationshipType,
} from './types.js';

export { RELATIONSHIP_TYPES, TIER_NAMES, LLM_PROVIDERS } from './types.js';

// Default profile
export { defaultProfile } from './default-profile.js';

// Resolution
export { resolveConfig, validateConfig, ConfigResolutionError } from './resolve.js';

// Builder
export { ConfigBuilder, createConfigBuilder } from './builder.js';

// Instance loading
export { loadInstance, InstanceLoadError } from './instance.js';
export type { LoadInstanceOptions, ConfigFactory, DarklingConfigExport } from './instance.js';
