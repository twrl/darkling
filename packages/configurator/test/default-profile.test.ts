import { describe, expect, it } from 'vitest';

import { defaultProfile } from '../src/index.js';

describe('defaultProfile', () => {
  it('provides a value for every section', () => {
    expect(defaultProfile.content).toBeDefined();
    expect(defaultProfile.llm).toBeDefined();
    expect(defaultProfile.stores).toBeDefined();
    expect(defaultProfile.access).toBeDefined();
    expect(defaultProfile.guide).toBeDefined();
    expect(defaultProfile.retrieval).toBeDefined();
    expect(defaultProfile.runtime).toBeDefined();
  });

  it('has a default content source', () => {
    expect(defaultProfile.content.source.type).toBe('inline');
    if (defaultProfile.content.source.type === 'inline') {
      expect(defaultProfile.content.source.path).toBe('./content');
    }
  });

  it('has the default relationship types', () => {
    expect(defaultProfile.content.relationshipTypes).toEqual([
      'references',
      'describes',
      'contrasts-with',
      'derived-from',
      'related-to',
    ]);
  });

  it('has a default Guide definition with a voice', () => {
    expect(defaultProfile.content.guideDefinition.voice.length).toBeGreaterThan(0);
  });

  it('has default guide budget policy matching the guide package', () => {
    expect(defaultProfile.guide.budgetPolicy.base).toBe(10);
    expect(defaultProfile.guide.budgetPolicy.premium).toEqual({
      direct_address: 4,
    });
    expect(defaultProfile.guide.budgetPolicy.toolCosts).toEqual({});
  });

  it('has default trigger probabilities with direct_address at 1.0', () => {
    expect(defaultProfile.guide.triggerProbabilities.direct_address).toBe(1.0);
  });

  it('has default retrieval policy matching the knowledge-base package', () => {
    expect(defaultProfile.retrieval.textSearchMechanism).toBe('linear-scan');
    expect(defaultProfile.retrieval.defaultResultLimit).toBe(20);
    expect(defaultProfile.retrieval.defaultSortPolicy).toBe('document-then-block');
  });

  it('has default runtime broadcast channel name', () => {
    expect(defaultProfile.runtime.broadcastChannelName).toBe('darkling-state');
  });

  it('has default tier policies', () => {
    expect(defaultProfile.access?.tiers.anonymous.spendCap).toBe(100);
    expect(defaultProfile.access?.tiers.token.spendCap).toBe(1000);
    expect(defaultProfile.access?.tiers.operator.spendCap).toBeNull();
    expect(defaultProfile.access?.tiers.operator.rateLimitPerMinute).toBeNull();
  });

  it('has default session persistence per tier', () => {
    expect(defaultProfile.access?.tiers.anonymous.sessionPersistence).toBe('ephemeral');
    expect(defaultProfile.access?.tiers.token.sessionPersistence).toBe('persistent');
    expect(defaultProfile.access?.tiers.operator.sessionPersistence).toBe('persistent');
  });
});
