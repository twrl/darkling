import { createConfigBuilder } from '../../../src/index.js';

// Export an async factory that returns a Promise<ConfigBuilder>
export default async () => {
  return createConfigBuilder().content({
    guideDefinition: { voice: 'Async factory returning builder test.' },
  });
};
