import { resolveConfig } from '../../../src/index.js';

// Export a Promise<Config>
export default Promise.resolve(
  resolveConfig({
    content: { guideDefinition: { voice: 'Promise config test.' } },
  }),
);
