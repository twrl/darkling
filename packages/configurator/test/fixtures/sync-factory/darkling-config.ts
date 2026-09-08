import { createConfigBuilder } from '../../../src/index.js';

// Export a sync factory function
export default () =>
  createConfigBuilder().content({ guideDefinition: { voice: 'Sync factory test.' } });
