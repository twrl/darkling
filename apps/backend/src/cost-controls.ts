/**
 * Cost and abuse controls: per-session spend cap and global rate limit
 * enforcement, tier-dependent, on the LLM proxy path.
 *
 * @see specs/usage-and-deployment.spec.md#cost-and-abuse-controls
 */

import type { Tier, BackendConfig, TierPolicy } from './config.js';

/** A session's usage counters. */
interface SessionUsage {
  spend: number;
}

/** The usage-tracking store (in-memory initial; Redis-swappable). */
export class UsageStore {
  private readonly sessions = new Map<string, SessionUsage>();
  /** Global rate-limit window: timestamps of recent calls per tier. */
  private readonly callTimestamps = new Map<Tier, number[]>();

  /** Record spend against a session. */
  addSpend(sessionId: string, cost: number): void {
    let usage = this.sessions.get(sessionId);
    if (!usage) {
      usage = { spend: 0 };
      this.sessions.set(sessionId, usage);
    }
    usage.spend += cost;
  }

  /** Get a session's cumulative spend. */
  getSpend(sessionId: string): number {
    return this.sessions.get(sessionId)?.spend ?? 0;
  }

  /** Discard a session's counters (on session end). */
  discard(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Record a call timestamp for rate-limiting. */
  recordCall(tier: Tier, now: number): void {
    let timestamps = this.callTimestamps.get(tier);
    if (!timestamps) {
      timestamps = [];
      this.callTimestamps.set(tier, timestamps);
    }
    timestamps.push(now);
  }

  /**
   * Count calls in the last `windowMs` for a tier, pruning older entries.
   */
  countRecentCalls(tier: Tier, now: number, windowMs: number): number {
    const timestamps = this.callTimestamps.get(tier) ?? [];
    const cutoff = now - windowMs;
    const recent = timestamps.filter((t) => t >= cutoff);
    this.callTimestamps.set(tier, recent);
    return recent.length;
  }
}

/** The verdict from cost-control enforcement. */
export type CostControlVerdict =
  | { ok: true }
  | { ok: false; reason: 'spend-cap'; spend: number; cap: number }
  | { ok: false; reason: 'rate-limit'; limit: number };

/**
 * Enforce the spend cap and rate limit for a session/tier, returning a verdict.
 * Called before forwarding an LLM call.
 */
export function enforceCostControls(
  usage: UsageStore,
  config: BackendConfig,
  tier: Tier,
  sessionId: string,
  now: number = Date.now(),
): CostControlVerdict {
  const policy: TierPolicy = config.tiers[tier];

  // Rate limit (global, per tier).
  if (policy.rateLimitPerMinute !== null) {
    const count = usage.countRecentCalls(tier, now, 60_000);
    if (count >= policy.rateLimitPerMinute) {
      return { ok: false, reason: 'rate-limit', limit: policy.rateLimitPerMinute };
    }
  }

  // Spend cap (per session).
  if (policy.spendCap !== null) {
    const spend = usage.getSpend(sessionId);
    if (spend >= policy.spendCap) {
      return { ok: false, reason: 'spend-cap', spend, cap: policy.spendCap };
    }
  }

  usage.recordCall(tier, now);
  return { ok: true };
}
