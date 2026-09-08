import { describe, expect, it } from 'vitest';

import {
  configSchema,
  defaultProfile,
  tierPolicySchema,
  type Config,
  type GuideDefinition,
} from '../src/index.js';

describe('types', () => {
  describe('GuideDefinition', () => {
    it('accepts a minimal definition with only voice', () => {
      const def: GuideDefinition = { voice: 'You are a wise archivist.' };
      const parsed = configSchema.shape.content.shape.guideDefinition.parse(def);
      expect(parsed.voice).toBe('You are a wise archivist.');
      expect(parsed.greeting).toBeUndefined();
      expect(parsed.safetyPosture).toBeUndefined();
    });

    it('accepts a string greeting', () => {
      const def: GuideDefinition = {
        voice: 'You are a wise archivist.',
        greeting: 'Welcome, traveler.',
      };
      const parsed = configSchema.shape.content.shape.guideDefinition.parse(def);
      expect(parsed.greeting).toBe('Welcome, traveler.');
    });

    it('accepts an array of greetings', () => {
      const def: GuideDefinition = {
        voice: 'You are a wise archivist.',
        greeting: ['Welcome.', 'Greetings, traveler.'],
      };
      const parsed = configSchema.shape.content.shape.guideDefinition.parse(def);
      expect(parsed.greeting).toEqual(['Welcome.', 'Greetings, traveler.']);
    });

    it('accepts a safety posture', () => {
      const def: GuideDefinition = {
        voice: 'You are a wise archivist.',
        safetyPosture: {
          disposition: 'encouraging',
          guidance: 'Encourage the visitor to seek help when needed.',
        },
      };
      const parsed = configSchema.shape.content.shape.guideDefinition.parse(def);
      expect(parsed.safetyPosture?.disposition).toBe('encouraging');
    });

    it('rejects an empty voice', () => {
      expect(() => configSchema.shape.content.shape.guideDefinition.parse({ voice: '' })).toThrow();
    });

    it('rejects a missing voice', () => {
      expect(() => configSchema.shape.content.shape.guideDefinition.parse({})).toThrow();
    });
  });

  describe('ContentSource', () => {
    it('accepts an inline source', () => {
      const source = { type: 'inline' as const, path: './content' };
      const parsed = configSchema.shape.content.shape.source.parse(source);
      expect(parsed).toEqual(source);
    });

    it('accepts a git source', () => {
      const source = {
        type: 'git' as const,
        url: 'https://github.com/me/world',
      };
      const parsed = configSchema.shape.content.shape.source.parse(source);
      expect(parsed).toEqual(source);
    });

    it('accepts a git source with ref', () => {
      const source = {
        type: 'git' as const,
        url: 'https://github.com/me/world',
        ref: 'main',
      };
      const parsed = configSchema.shape.content.shape.source.parse(source);
      expect(parsed).toEqual(source);
    });

    it('rejects an unknown source type', () => {
      expect(() =>
        configSchema.shape.content.shape.source.parse({ type: 'svn', url: 'x' }),
      ).toThrow();
    });

    it('rejects inline without path', () => {
      expect(() => configSchema.shape.content.shape.source.parse({ type: 'inline' })).toThrow();
    });

    it('rejects git without url', () => {
      expect(() => configSchema.shape.content.shape.source.parse({ type: 'git' })).toThrow();
    });
  });

  describe('BudgetPolicy', () => {
    it('accepts a valid budget policy', () => {
      const policy = {
        base: 10,
        premium: { direct_address: 4 },
        toolCosts: {},
      };
      const parsed = configSchema.shape.guide.shape.budgetPolicy.parse(policy);
      expect(parsed.base).toBe(10);
    });

    it('rejects a negative base', () => {
      expect(() =>
        configSchema.shape.guide.shape.budgetPolicy.parse({
          base: -1,
          premium: {},
          toolCosts: {},
        }),
      ).toThrow();
    });
  });

  describe('TierPolicy', () => {
    it('accepts a tier with null spend cap (no cap)', () => {
      const policy = {
        spendCap: null,
        rateLimitPerMinute: null,
        sessionPersistence: 'persistent',
      };
      const parsed = tierPolicySchema.parse(policy);
      expect(parsed.spendCap).toBeNull();
    });

    it('rejects a negative spend cap', () => {
      expect(() =>
        tierPolicySchema.parse({
          spendCap: -1,
          rateLimitPerMinute: 10,
          sessionPersistence: 'ephemeral',
        }),
      ).toThrow();
    });

    it('rejects an invalid persistence value', () => {
      expect(() =>
        tierPolicySchema.parse({
          spendCap: 100,
          rateLimitPerMinute: 10,
          sessionPersistence: 'always',
        }),
      ).toThrow();
    });
  });

  describe('triggerProbabilities', () => {
    it('rejects a probability > 1.0', () => {
      expect(() =>
        configSchema.shape.guide.shape.triggerProbabilities.parse({
          direct_address: 1.5,
        }),
      ).toThrow();
    });

    it('rejects a probability < 0', () => {
      expect(() =>
        configSchema.shape.guide.shape.triggerProbabilities.parse({
          direct_address: -0.1,
        }),
      ).toThrow();
    });

    it('accepts 0.0 and 1.0', () => {
      const parsed = configSchema.shape.guide.shape.triggerProbabilities.parse({
        a: 0.0,
        b: 1.0,
      });
      expect(parsed.a).toBe(0.0);
      expect(parsed.b).toBe(1.0);
    });
  });

  describe('full config schema', () => {
    it('validates the default profile', () => {
      const result = configSchema.safeParse(defaultProfile);
      expect(result.success).toBe(true);
    });

    it('accepts a config without backend-only sections (frontend)', () => {
      const frontendConfig: Config = {
        content: defaultProfile.content,
        guide: defaultProfile.guide,
        retrieval: defaultProfile.retrieval,
        runtime: defaultProfile.runtime,
      };
      const result = configSchema.safeParse(frontendConfig);
      expect(result.success).toBe(true);
    });

    it('rejects a config missing required sections', () => {
      const result = configSchema.safeParse({
        content: defaultProfile.content,
      });
      expect(result.success).toBe(false);
    });
  });
});
