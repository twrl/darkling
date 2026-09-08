import { createConfigBuilder } from '../../../src/index.js';

// Export an async factory function
export default async () =>
  createConfigBuilder().content({ guideDefinition: { voice: 'Async factory test.' } });
