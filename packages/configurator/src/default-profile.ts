/**
 * The system-wide default profile.
 *
 * Provides a value for every policy parameter defined by the domain
 * specifications, conforming to the types established by their owning
 * specifications. This is the baseline against which overrides are applied,
 * as defined by the usage-and-deployment specification.
 *
 * The specific values are implementation-defined, chosen as reasonable
 * defaults for development and local operation. They are not normative.
 */

import type { Config } from './types.js';

/**
 * The default profile. Identified as the system default.
 *
 * @example
 * ```ts
 * import { defaultProfile } from '@darkling/configurator';
 * // defaultProfile.guide.budgetPolicy.base === 10
 * // defaultProfile.retrieval.defaultResultLimit === 20
 * // defaultProfile.runtime.broadcastChannelName === 'darkling-state'
 * ```
 */
export const defaultProfile: Config = {
  content: {
    source: {
      type: 'inline',
      path: './content',
    },
    relationshipTypes: ['references', 'describes', 'contrasts-with', 'derived-from', 'related-to'],
    propertySchema: {
      document: {
        slug: { match: 'exact' },
        title: { match: 'substring' },
      },
      block: {
        title: { match: 'substring' },
        document: { match: 'exact' },
      },
    },
    guideDefinition: {
      voice:
        'You are the Guide, an AI curator of the Archive. You are knowledgeable, curious, and patient. You speak in a warm, measured tone and help Visitors explore the world of the Archive.',
    },
  },

  llm: {
    provider: 'openrouter',
    apiKey: '',
  },

  stores: {},

  access: {
    tiers: {
      anonymous: {
        spendCap: 100,
        rateLimitPerMinute: 10,
        sessionPersistence: 'ephemeral',
      },
      token: {
        spendCap: 1000,
        rateLimitPerMinute: 60,
        sessionPersistence: 'persistent',
      },
      operator: {
        spendCap: null,
        rateLimitPerMinute: null,
        sessionPersistence: 'persistent',
      },
    },
    tokenSecret: 'darkling-dev-token-secret-key',
    tokenTtlMs: 86_400_000, // 24 hours
  },

  guide: {
    triggerProbabilities: {
      direct_address: 1.0,
      document_opened: 0.5,
      document_closed: 0.3,
      attention_drawn: 0.5,
      relationship_traversed: 0.5,
      scroll: 0.1,
    },
    budgetPolicy: {
      base: 10,
      premium: { direct_address: 4 },
      toolCosts: {},
    },
    maxTurns: 20,
  },

  retrieval: {
    propertySchema: {
      document: {
        slug: { match: 'exact' },
        title: { match: 'substring' },
      },
      block: {
        title: { match: 'substring' },
        document: { match: 'exact' },
      },
    },
    textSearchMechanism: 'linear-scan',
    defaultResultLimit: 20,
    defaultSortPolicy: 'document-then-block',
  },

  runtime: {
    broadcastChannelName: 'darkling-state',
    callTimeoutMs: 30_000,
  },
};
