import { createConfigBuilder } from '../../../src/index.js';

// Export a ConfigBuilder directly
export default createConfigBuilder().content({
  guideDefinition: { voice: 'Builder export test.' },
});
