import { resolveConfig } from '../../../src/index.js';

// Re-export for module specifier resolution test
export default resolveConfig({
  content: { guideDefinition: { voice: 'Config export test.' } },
});
