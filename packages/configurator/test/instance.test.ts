import { describe, expect, it } from 'vitest';

import { InstanceLoadError, loadInstance } from '../src/index.js';

/**
 * Build a file URL for a fixture directory's darkling-config entry point.
 * loadInstance appends /darkling-config to the directory specifier.
 */
function fixtureDir(name: string): string {
  return new URL(`./fixtures/${name}/`, import.meta.url).href;
}

/**
 * Build a file URL for a fixture's darkling-config.ts file directly.
 */
function fixtureFile(name: string): string {
  return new URL(`./fixtures/${name}/darkling-config.ts`, import.meta.url).href;
}

describe('loadInstance', () => {
  describe('module specifier resolution', () => {
    it('appends /darkling-config if not present', async () => {
      const config = await loadInstance({
        moduleSpecifier: fixtureDir('config-export'),
      });
      expect(config.content.guideDefinition.voice).toBe('Config export test.');
    });

    it('uses specifier as-is when it already ends in /darkling-config', async () => {
      const config = await loadInstance({
        moduleSpecifier: fixtureFile('config-export'),
      });
      expect(config.content.guideDefinition.voice).toBe('Config export test.');
    });
  });

  describe('accepted export forms', () => {
    it('loads a Config default export', async () => {
      const config = await loadInstance({
        moduleSpecifier: fixtureDir('config-export'),
      });
      expect(config.content.guideDefinition.voice).toBe('Config export test.');
    });

    it('loads a ConfigBuilder default export', async () => {
      const config = await loadInstance({
        moduleSpecifier: fixtureDir('builder-export'),
      });
      expect(config.content.guideDefinition.voice).toBe('Builder export test.');
    });

    it('loads a sync factory function', async () => {
      const config = await loadInstance({
        moduleSpecifier: fixtureDir('sync-factory'),
      });
      expect(config.content.guideDefinition.voice).toBe('Sync factory test.');
    });

    it('loads an async factory function', async () => {
      const config = await loadInstance({
        moduleSpecifier: fixtureDir('async-factory'),
      });
      expect(config.content.guideDefinition.voice).toBe('Async factory test.');
    });

    it('loads a Promise<ConfigBuilder>', async () => {
      const config = await loadInstance({
        moduleSpecifier: fixtureDir('promise-builder'),
      });
      expect(config.content.guideDefinition.voice).toBe('Promise builder test.');
    });

    it('loads a Promise<Config>', async () => {
      const config = await loadInstance({
        moduleSpecifier: fixtureDir('promise-config'),
      });
      expect(config.content.guideDefinition.voice).toBe('Promise config test.');
    });

    it('loads an async factory returning a ConfigBuilder', async () => {
      const config = await loadInstance({
        moduleSpecifier: fixtureDir('async-factory-builder'),
      });
      expect(config.content.guideDefinition.voice).toBe('Async factory returning builder test.');
    });
  });

  describe('error cases', () => {
    it('throws InstanceLoadError for a module with no default export', async () => {
      await expect(
        loadInstance({
          moduleSpecifier: fixtureDir('no-default'),
        }),
      ).rejects.toThrow(InstanceLoadError);
    });

    it('throws InstanceLoadError for an invalid export', async () => {
      await expect(
        loadInstance({
          moduleSpecifier: fixtureDir('invalid-export'),
        }),
      ).rejects.toThrow(InstanceLoadError);
    });

    it('throws InstanceLoadError for a non-existent module', async () => {
      await expect(
        loadInstance({
          moduleSpecifier: fixtureDir('does-not-exist'),
        }),
      ).rejects.toThrow(InstanceLoadError);
    });

    it('error message includes the module specifier', async () => {
      try {
        await loadInstance({
          moduleSpecifier: fixtureDir('no-default'),
        });
        expect.fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceLoadError);
        const message = (error as InstanceLoadError).message;
        expect(message).toContain('no-default');
      }
    });

    it('InstanceLoadError has the correct name', () => {
      const error = new InstanceLoadError('test');
      expect(error.name).toBe('InstanceLoadError');
    });

    it('InstanceLoadError carries an optional cause', () => {
      const cause = new Error('inner');
      const error = new InstanceLoadError('outer', cause);
      expect(error.cause).toBe(cause);
    });
  });
});
