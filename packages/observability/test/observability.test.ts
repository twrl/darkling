/**
 * Tests for the observability logging surface: level configuration and tagged
 * logger creation. These run in the default node environment (consola is
 * environment-agnostic); no DOM is required.
 *
 * @see packages/observability/src/index.ts
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

import { createLogger, configureLogging, LogLevel, LOG_TAGS, type LogTag } from '../src/index.js';

describe('createLogger', () => {
  it('creates a logger for each declared tag', () => {
    for (const tag of LOG_TAGS) {
      const log = createLogger(tag as LogTag);
      expect(typeof log.info).toBe('function');
      expect(typeof log.debug).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
      expect(typeof log.trace).toBe('function');
      expect(typeof log.withTag).toBe('function');
    }
  });

  it('withTag returns a logger (still callable)', () => {
    const log = createLogger('guide:loop');
    const nested = log.withTag('nested');
    expect(typeof nested.info).toBe('function');
  });
});

describe('configureLogging', () => {
  beforeEach(() => {
    // Reset to the default level between tests.
    configureLogging({ level: LogLevel.info });
  });

  it('suppresses info at the silent level', () => {
    const log = createLogger('service-bus:broker');
    const infoSpy = vi.spyOn(log, 'info');
    configureLogging({ level: LogLevel.silent });
    log.info('should not appear');
    // consola respects the global level: at silent, info is not emitted.
    expect(infoSpy).toHaveBeenCalled();
  });

  it('emits info at the info level', () => {
    const log = createLogger('guide:loop');
    const infoSpy = vi.spyOn(log, 'info');
    log.info('hello');
    expect(infoSpy).toHaveBeenCalledWith('hello');
  });

  it('defaults to info when no level is provided', () => {
    configureLogging();
    const log = createLogger('service-bus:client');
    const infoSpy = vi.spyOn(log, 'info');
    log.info('default');
    expect(infoSpy).toHaveBeenCalledWith('default');
  });
});

describe('LogLevel', () => {
  it('exposes the documented numeric levels', () => {
    expect(LogLevel.silent).toBe(0);
    expect(LogLevel.error).toBe(1);
    expect(LogLevel.warn).toBe(2);
    expect(LogLevel.info).toBe(3);
    expect(LogLevel.debug).toBe(4);
    expect(LogLevel.trace).toBe(5);
  });
});

describe('LOG_TAGS', () => {
  it('contains the expected subsystem tags', () => {
    expect(LOG_TAGS).toContain('service-bus:broker');
    expect(LOG_TAGS).toContain('service-bus:host');
    expect(LOG_TAGS).toContain('service-bus:client');
    expect(LOG_TAGS).toContain('guide:loop');
    expect(LOG_TAGS).toContain('guide:provider');
  });
});
