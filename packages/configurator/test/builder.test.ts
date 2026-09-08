import { describe, expect, it } from 'vitest';

import { ConfigBuilder, createConfigBuilder, defaultProfile } from '../src/index.js';

describe('ConfigBuilder', () => {
  describe('basic fluent API', () => {
    it('returns a ConfigBuilder instance', () => {
      expect(createConfigBuilder()).toBeInstanceOf(ConfigBuilder);
    });

    it('produces the default profile with no overrides', () => {
      const config = createConfigBuilder().build();
      expect(config.content).toEqual(defaultProfile.content);
      expect(config.guide).toEqual(defaultProfile.guide);
      expect(config.retrieval).toEqual(defaultProfile.retrieval);
      expect(config.runtime).toEqual(defaultProfile.runtime);
    });

    it('supports method chaining', () => {
      const builder = createConfigBuilder()
        .content({ source: { type: 'git', url: 'https://github.com/me/world' } })
        .guide({ budgetPolicy: { base: 15, premium: {}, toolCosts: {} } })
        .retrieval({ defaultResultLimit: 50 })
        .runtime({ broadcastChannelName: 'my-channel' });

      expect(builder).toBeInstanceOf(ConfigBuilder);
      const config = builder.build();
      expect(config.content.source).toEqual({
        type: 'git',
        url: 'https://github.com/me/world',
      });
      expect(config.guide.budgetPolicy.base).toBe(15);
      expect(config.retrieval.defaultResultLimit).toBe(50);
      expect(config.runtime.broadcastChannelName).toBe('my-channel');
    });
  });

  describe('section methods', () => {
    it('content() accepts partial content config', () => {
      const config = createConfigBuilder()
        .content({
          guideDefinition: { voice: 'You are a test guide.' },
        })
        .build();
      expect(config.content.guideDefinition.voice).toBe('You are a test guide.');
      // Non-overridden content fields retain defaults
      expect(config.content.source).toEqual(defaultProfile.content.source);
    });

    it('content() accumulates across calls', () => {
      const config = createConfigBuilder()
        .content({ source: { type: 'git', url: 'https://example.com/repo' } })
        .content({ guideDefinition: { voice: 'Accumulated.' } })
        .build();
      expect(config.content.source).toEqual({
        type: 'git',
        url: 'https://example.com/repo',
      });
      expect(config.content.guideDefinition.voice).toBe('Accumulated.');
    });

    it('guide() accepts partial guide config', () => {
      const config = createConfigBuilder().guide({ maxTurns: 30 }).build();
      expect(config.guide.maxTurns).toBe(30);
      expect(config.guide.budgetPolicy).toEqual(defaultProfile.guide.budgetPolicy);
    });

    it('retrieval() accepts partial retrieval config', () => {
      const config = createConfigBuilder()
        .retrieval({ textSearchMechanism: 'inverted-index' })
        .build();
      expect(config.retrieval.textSearchMechanism).toBe('inverted-index');
      expect(config.retrieval.defaultResultLimit).toBe(defaultProfile.retrieval.defaultResultLimit);
    });

    it('runtime() accepts partial runtime config', () => {
      const config = createConfigBuilder().runtime({ callTimeoutMs: 60_000 }).build();
      expect(config.runtime.callTimeoutMs).toBe(60_000);
      expect(config.runtime.broadcastChannelName).toBe(defaultProfile.runtime.broadcastChannelName);
    });

    it('llm() sets the llm section', () => {
      const config = createConfigBuilder().llm({ provider: 'openai', apiKey: 'sk-test' }).build();
      expect(config.llm?.provider).toBe('openai');
      expect(config.llm?.apiKey).toBe('sk-test');
    });

    it('stores() sets the stores section', () => {
      const config = createConfigBuilder()
        .stores({ persistent: { url: 'redis://localhost:6379' } })
        .build();
      expect(config.stores?.persistent?.url).toBe('redis://localhost:6379');
    });

    it('access() sets the access section', () => {
      const config = createConfigBuilder()
        .access({
          tokenSecret: 'this-is-a-long-enough-secret',
          tokenTtlMs: 36_000_000,
        })
        .build();
      expect(config.access?.tokenSecret).toBe('this-is-a-long-enough-secret');
      expect(config.access?.tokenTtlMs).toBe(36_000_000);
    });
  });

  describe('frontend()', () => {
    it('excludes llm, stores, and access from the resolved config', () => {
      const config = createConfigBuilder()
        .llm({ provider: 'openai', apiKey: 'sk-test' })
        .stores({ persistent: { url: 'redis://localhost:6379' } })
        .access({
          tokenSecret: 'this-is-a-long-enough-secret',
          tokenTtlMs: 36_000_000,
        })
        .frontend()
        .build();

      expect(config.llm).toBeUndefined();
      expect(config.stores).toBeUndefined();
      expect(config.access).toBeUndefined();
    });

    it('still includes content, guide, retrieval, and runtime', () => {
      const config = createConfigBuilder().frontend().build();

      expect(config.content).toBeDefined();
      expect(config.guide).toBeDefined();
      expect(config.retrieval).toBeDefined();
      expect(config.runtime).toBeDefined();
    });

    it('frontend overrides to backend sections are ignored', () => {
      const config = createConfigBuilder()
        .llm({ provider: 'anthropic', apiKey: 'sk-frontend' })
        .frontend()
        .build();

      expect(config.llm).toBeUndefined();
    });
  });

  describe('build() validation', () => {
    it('rejects invalid values at build time', () => {
      expect(() =>
        createConfigBuilder()
          .guide({ budgetPolicy: { base: -1, premium: {}, toolCosts: {} } })
          .build(),
      ).toThrow();
    });

    it('rejects invalid trigger probabilities at build time', () => {
      expect(() =>
        createConfigBuilder()
          .guide({ triggerProbabilities: { bad: 2.0 } })
          .build(),
      ).toThrow();
    });
  });

  describe('immutability', () => {
    it('build() returns a frozen object', () => {
      const config = createConfigBuilder().build();
      expect(Object.isFrozen(config)).toBe(true);
    });
  });
});
