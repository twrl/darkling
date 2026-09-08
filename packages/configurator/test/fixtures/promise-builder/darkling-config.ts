import { createConfigBuilder } from '../../../src/index.js';

// Export a Promise<ConfigBuilder>
export default Promise.resolve(
  createConfigBuilder().content({ guideDefinition: { voice: 'Promise builder test.' } }),
);
