/**
 * Config type definitions for `@darkling/configurator`.
 *
 * The `Config` type is the resolved, typed configuration object organised into
 * the seven sections defined by the usage-and-deployment specification:
 * content, llm, stores, access, guide, retrieval, runtime.
 *
 * The policy parameter types within each section conform to the parameter
 * tables in their owning domain specifications. They are defined inline in
 * this package rather than re-exported from the subsystem packages, keeping
 * the configurator a standalone tool with no Darkling package dependencies.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Access tier
// ---------------------------------------------------------------------------

export const TIER_NAMES = ['anonymous', 'token', 'operator'] as const;
export type TierName = (typeof TIER_NAMES)[number];

export const tierNameSchema = z.enum(TIER_NAMES);

// ---------------------------------------------------------------------------
// Guide definition (hybrid assembly input)
// ---------------------------------------------------------------------------

export const guideDefinitionSchema = z.object({
  /** Free-form text defining the Guide's personality, manner, and voice. Required. */
  voice: z.string().min(1),
  /** Optional greeting template or set of candidate greetings. */
  greeting: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  /** Optional safety disposition (e.g. encouragement to consult the safety consultant). */
  safetyPosture: z
    .object({
      disposition: z.enum(['encouraging', 'cautionary', 'silent']),
      guidance: z.string().optional(),
    })
    .optional(),
});

export type GuideDefinition = z.infer<typeof guideDefinitionSchema>;

// ---------------------------------------------------------------------------
// Content section
// ---------------------------------------------------------------------------

export const contentSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('inline'),
    /** Filesystem path to inline content (relative to the instance package). */
    path: z.string().min(1),
  }),
  z.object({
    type: z.literal('git'),
    /** Git repository URL for the external content source. */
    url: z.string().min(1),
    /** Optional branch or ref; defaults to the repository's default branch. */
    ref: z.string().optional(),
  }),
]);

export type ContentSource = z.infer<typeof contentSourceSchema>;

export const RELATIONSHIP_TYPES = [
  'references',
  'describes',
  'contrasts-with',
  'derived-from',
  'related-to',
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const matchSemanticsSchema = z.enum(['exact', 'substring', 'prefix']);

export const propertySchemaSchema = z.object({
  document: z.record(z.string(), z.object({ match: matchSemanticsSchema })),
  block: z.record(z.string(), z.object({ match: matchSemanticsSchema })),
});

export type PropertySchema = z.infer<typeof propertySchemaSchema>;

export const contentConfigSchema = z.object({
  /** The content source: inline content or an external git repository. */
  source: contentSourceSchema,
  /** Relationship-type vocabulary for the content. */
  relationshipTypes: z.array(z.enum(RELATIONSHIP_TYPES)).min(1),
  /** Filterable property schema for retrieval. */
  propertySchema: propertySchemaSchema,
  /** The Guide definition (voice, greeting, safety posture). Lives in the content repository. */
  guideDefinition: guideDefinitionSchema,
});

export type ContentConfig = z.infer<typeof contentConfigSchema>;

// ---------------------------------------------------------------------------
// LLM section (backend-only)
// ---------------------------------------------------------------------------

export const LLM_PROVIDERS = ['openrouter', 'openai', 'anthropic', 'local'] as const;
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

export const llmConfigSchema = z.object({
  /** The LLM provider selection. */
  provider: z.enum(LLM_PROVIDERS),
  /** The API key for the selected provider. Held by the backend; never sent to the frontend. Empty string in the default profile; overridden from the deployment environment. */
  apiKey: z.string(),
  /** Optional model identifier. */
  model: z.string().optional(),
  /** Optional provider-specific endpoint override. */
  endpoint: z.string().optional(),
});

export type LlmConfig = z.infer<typeof llmConfigSchema>;

// ---------------------------------------------------------------------------
// Stores section (backend-only)
// ---------------------------------------------------------------------------

export const storesConfigSchema = z.object({
  /** Persistent store connection (e.g. Upstash Redis URL) for compiled content + non-secret config cache. */
  persistent: z
    .object({
      url: z.string().min(1),
      token: z.string().optional(),
    })
    .optional(),
  /** Secret store connection for pre-shared secrets. May share a physical store with persistent. */
  secret: z
    .object({
      url: z.string().min(1),
      token: z.string().optional(),
    })
    .optional(),
  /** Usage tracking store connection for spend/rate-limit counters. May share a physical store. */
  usage: z
    .object({
      url: z.string().min(1),
      token: z.string().optional(),
    })
    .optional(),
});

export type StoresConfig = z.infer<typeof storesConfigSchema>;

// ---------------------------------------------------------------------------
// Access section (backend-only)
// ---------------------------------------------------------------------------

export const tierPolicySchema = z.object({
  /** Per-session spend cap; null means no cap. */
  spendCap: z.number().nonnegative().nullable(),
  /** Global rate limit per minute; null means no limit. */
  rateLimitPerMinute: z.number().nonnegative().nullable(),
  /** Whether session state persists across visits for this tier. */
  sessionPersistence: z.enum(['persistent', 'ephemeral']),
});

export type TierPolicy = z.infer<typeof tierPolicySchema>;

export const accessConfigSchema = z.object({
  /** Per-tier policies keyed by tier name. */
  tiers: z.record(tierNameSchema, tierPolicySchema),
  /** Pre-shared secrets (issued out of band). Format: array of { secret, tier }. */
  secrets: z
    .array(
      z.object({
        secret: z.string().min(1),
        tier: tierNameSchema,
      }),
    )
    .optional(),
  /** Token signing secret and TTL. */
  tokenSecret: z.string().min(16),
  tokenTtlMs: z.number().int().positive(),
});

export type AccessConfig = z.infer<typeof accessConfigSchema>;

// ---------------------------------------------------------------------------
// Guide section (constrained-agent policy parameters)
// ---------------------------------------------------------------------------

export const budgetPolicySchema = z.object({
  /** Fixed budget amount for every interaction; denominator of the overspend gate. */
  base: z.number().nonnegative(),
  /** Premium per event type (serialisable form of the premium function). */
  premium: z.record(z.string(), z.number()),
  /** Costs per tool name; missing entry defaults to 0. */
  toolCosts: z.record(z.string(), z.number()),
});

export type BudgetPolicy = z.infer<typeof budgetPolicySchema>;

export const guideConfigSchema = z.object({
  /** Trigger probability per event type, in [0.0, 1.0]. */
  triggerProbabilities: z.record(z.string(), z.number().min(0).max(1)),
  /** Budget composition: base, premium, tool costs. */
  budgetPolicy: budgetPolicySchema,
  /** Maximum turns per interaction. */
  maxTurns: z.number().int().positive(),
});

export type GuideConfig = z.infer<typeof guideConfigSchema>;

// ---------------------------------------------------------------------------
// Retrieval section (content-first-retrieval policy parameters)
// ---------------------------------------------------------------------------

export const retrievalConfigSchema = z.object({
  /** Filterable property schema. */
  propertySchema: propertySchemaSchema,
  /** The mechanism used for retrieval by textual content. */
  textSearchMechanism: z.enum(['linear-scan', 'inverted-index', 'vector', 'hybrid']),
  /** The default maximum number of results returned when no limit is specified. */
  defaultResultLimit: z.number().int().positive(),
  /** The default ordering for retrieval by properties results. */
  defaultSortPolicy: z.enum(['document-then-block']),
});

export type RetrievalConfig = z.infer<typeof retrievalConfigSchema>;

// ---------------------------------------------------------------------------
// Runtime section (runtime policy parameters)
// ---------------------------------------------------------------------------

export const runtimeConfigSchema = z.object({
  /** BroadcastChannel name for state-change propagation. Must be consistent across all threads. */
  broadcastChannelName: z.string().min(1),
  /** Call timeout for runtime service calls, in milliseconds. */
  callTimeoutMs: z.number().int().positive(),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

// ---------------------------------------------------------------------------
// Top-level Config
// ---------------------------------------------------------------------------

/**
 * The resolved, typed configuration object.
 *
 * Backend configurations include all sections. Frontend configurations
 * exclude `llm`, `stores`, and `access` (the backend-only sections).
 */
export const configSchema = z.object({
  content: contentConfigSchema,
  llm: llmConfigSchema.optional(),
  stores: storesConfigSchema.optional(),
  access: accessConfigSchema.optional(),
  guide: guideConfigSchema,
  retrieval: retrievalConfigSchema,
  runtime: runtimeConfigSchema,
});

export type Config = z.infer<typeof configSchema>;

/**
 * A partial configuration providing overrides. Each section is optional,
 * and within each section, fields are optional. This is the shape accepted
 * by `resolveConfig` and by `ConfigBuilder` section methods.
 *
 * Note: `access.tiers` is a partial record — individual tier overrides
 * take precedence over the default profile's tiers, and non-overridden
 * tiers are preserved.
 */
export type ConfigOverrides = {
  content?: Partial<ContentConfig>;
  llm?: Partial<LlmConfig>;
  stores?: Partial<StoresConfig>;
  access?: Partial<Omit<AccessConfig, 'tiers'>> & {
    tiers?: Partial<Record<TierName, TierPolicy>>;
  };
  guide?: Partial<GuideConfig>;
  retrieval?: Partial<RetrievalConfig>;
  runtime?: Partial<RuntimeConfig>;
};
