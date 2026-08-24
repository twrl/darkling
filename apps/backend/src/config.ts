/**
 * Backend configuration: resolved at startup from environment variables /
 * defaults, as defined by [Policy and configuration](../../specs/policy-and-configuration.spec.md).
 *
 * @see specs/usage-and-deployment.spec.md
 */

import { z } from 'zod';

/** The access tiers, as defined by [Usage and deployment](../../specs/usage-and-deployment.spec.md#token-issuance-and-tiers). */
export type Tier = 'anonymous' | 'token' | 'operator';

/** Per-tier cost/abuse control values. */
export interface TierPolicy {
  /** Per-session spend cap in cost units; `null` means no cap (operator). */
  spendCap: number | null;
  /** Global rate limit (calls per minute) across all sessions; `null` means none. */
  rateLimitPerMinute: number | null;
}

/** Pre-shared secret record: the secret string and the tier it grants. */
export interface SecretRecord {
  secret: string;
  tier: Tier;
}

/** Resolved backend configuration. */
export interface BackendConfig {
  /** The port to listen on. */
  port: number;
  /** The LLM provider API key (held server-side; never sent to the frontend). */
  llmApiKey: string;
  /** The LLM model (OpenRouter model string, e.g. "openai/gpt-4o"). */
  llmModel?: string;
  /** The OpenRouter endpoint (overridable for testing). */
  llmEndpoint?: string;
  /** HMAC secret for signing tokens. */
  tokenSecret: string;
  /** Token lifetime in milliseconds. */
  tokenTtlMs: number;
  /** Pre-shared secrets and the tiers they grant. */
  secrets: SecretRecord[];
  /** Per-tier cost/abuse control values. */
  tiers: Record<Tier, TierPolicy>;
  /** The filesystem path to the content source (a git working copy). */
  contentSourcePath: string;
}

const DEFAULT_TIERS: Record<Tier, TierPolicy> = {
  anonymous: { spendCap: 100, rateLimitPerMinute: 10 },
  token: { spendCap: 1000, rateLimitPerMinute: 60 },
  operator: { spendCap: null, rateLimitPerMinute: null },
};

function parseSecrets(env: string | undefined): SecretRecord[] {
  // Format: "secret1:tier,secret2:tier" e.g. "abc123:token,xyz789:operator"
  if (!env) return [];
  return env
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [secret, tier] = entry.split(':');
      return { secret, tier: tier as Tier };
    })
    .filter((r): r is SecretRecord => Boolean(r.secret) && Boolean(r.tier));
}

/** Resolve the backend configuration from environment variables. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const parsed = z
    .object({
      PORT: z.coerce.number().default(8787),
      LLM_API_KEY: z.string().min(1),
      LLM_MODEL: z.string().optional(),
      LLM_ENDPOINT: z.string().optional(),
      TOKEN_SECRET: z.string().min(16).default('darkling-dev-token-secret-key'),
      TOKEN_TTL_MS: z.coerce.number().default(24 * 60 * 60 * 1000),
      CONTENT_SOURCE_PATH: z.string().default('./content'),
      SECRETS: z.string().optional(),
    })
    .parse(env);

  return {
    port: parsed.PORT,
    llmApiKey: parsed.LLM_API_KEY,
    llmModel: parsed.LLM_MODEL,
    llmEndpoint: parsed.LLM_ENDPOINT,
    tokenSecret: parsed.TOKEN_SECRET,
    tokenTtlMs: parsed.TOKEN_TTL_MS,
    secrets: parseSecrets(parsed.SECRETS),
    tiers: DEFAULT_TIERS,
    contentSourcePath: parsed.CONTENT_SOURCE_PATH,
  };
}
