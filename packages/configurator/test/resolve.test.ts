import { describe, expect, it } from 'vitest';

import {
  ConfigResolutionError,
  defaultProfile,
  resolveConfig,
  validateConfig,
} from '../src/index.js';

describe('resolveConfig', () => {
  it('returns the default profile when no overrides are provided', () => {
    const config = resolveConfig();
    expect(config.content).toEqual(defaultProfile.content);
    expect(config.guide).toEqual(defaultProfile.guide);
    expect(config.retrieval).toEqual(defaultProfile.retrieval);
    expect(config.runtime).toEqual(defaultProfile.runtime);
  });

  it('applies overrides over defaults', () => {
    const config = resolveConfig({
      guide: { budgetPolicy: { base: 15, premium: {}, toolCosts: {} } },
    });
    expect(config.guide.budgetPolicy.base).toBe(15);
    // Non-overridden fields retain defaults
    expect(config.guide.maxTurns).toBe(defaultProfile.guide.maxTurns);
  });

  it('merges at section level, not deep-merge within fields', () => {
    const config = resolveConfig({
      guide: { budgetPolicy: { base: 20, premium: {}, toolCosts: {} } },
    });
    // budgetPolicy is replaced as a whole field, so premium is the override's
    expect(config.guide.budgetPolicy.premium).toEqual({});
  });

  it('applies content overrides', () => {
    const config = resolveConfig({
      content: {
        source: { type: 'git', url: 'https://github.com/me/world' },
      },
    });
    expect(config.content.source).toEqual({
      type: 'git',
      url: 'https://github.com/me/world',
    });
    // Non-overridden content fields retain defaults
    expect(config.content.relationshipTypes).toEqual(defaultProfile.content.relationshipTypes);
  });

  it('applies retrieval overrides', () => {
    const config = resolveConfig({
      retrieval: { defaultResultLimit: 50 },
    });
    expect(config.retrieval.defaultResultLimit).toBe(50);
    expect(config.retrieval.textSearchMechanism).toBe(defaultProfile.retrieval.textSearchMechanism);
  });

  it('applies runtime overrides', () => {
    const config = resolveConfig({
      runtime: { broadcastChannelName: 'my-channel' },
    });
    expect(config.runtime.broadcastChannelName).toBe('my-channel');
  });

  it('applies llm overrides', () => {
    const config = resolveConfig({
      llm: { provider: 'anthropic', apiKey: 'sk-test' },
    });
    expect(config.llm?.provider).toBe('anthropic');
    expect(config.llm?.apiKey).toBe('sk-test');
  });

  it('applies access overrides with deep-merge on tiers', () => {
    const config = resolveConfig({
      access: {
        tiers: {
          anonymous: {
            spendCap: 200,
            rateLimitPerMinute: 20,
            sessionPersistence: 'ephemeral',
          },
        },
      },
    });
    expect(config.access?.tiers.anonymous.spendCap).toBe(200);
    // Non-overridden tiers are preserved (deep-merge on tiers)
    expect(config.access?.tiers.token).toEqual(defaultProfile.access?.tiers.token);
    expect(config.access?.tiers.operator).toEqual(defaultProfile.access?.tiers.operator);
  });

  it('returns a frozen config object', () => {
    const config = resolveConfig();
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('rejects an invalid override value', () => {
    expect(() =>
      resolveConfig({
        guide: {
          budgetPolicy: {
            base: -5,
            premium: {},
            toolCosts: {},
          },
        },
      }),
    ).toThrow(ConfigResolutionError);
  });

  it('rejects an invalid trigger probability', () => {
    expect(() =>
      resolveConfig({
        guide: {
          triggerProbabilities: { bad_event: 1.5 },
        },
      }),
    ).toThrow(ConfigResolutionError);
  });

  it('includes path information in the error message', () => {
    try {
      resolveConfig({
        guide: {
          budgetPolicy: { base: -1, premium: {}, toolCosts: {} },
        },
      });
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigResolutionError);
      expect((error as ConfigResolutionError).message).toContain('budgetPolicy');
    }
  });
});

describe('validateConfig', () => {
  it('validates and returns a valid config', () => {
    const config = validateConfig(defaultProfile);
    expect(config).toEqual(defaultProfile);
  });

  it('rejects an invalid config', () => {
    expect(() => validateConfig({ foo: 'bar' })).toThrow(ConfigResolutionError);
  });

  it('returns a frozen object', () => {
    const config = validateConfig(defaultProfile);
    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe('ConfigResolutionError', () => {
  it('has the correct name', () => {
    const error = new ConfigResolutionError('test');
    expect(error.name).toBe('ConfigResolutionError');
  });

  it('carries an optional cause', () => {
    const cause = new Error('inner');
    const error = new ConfigResolutionError('outer', cause);
    expect(error.cause).toBe(cause);
  });
});
