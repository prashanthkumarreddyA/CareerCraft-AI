import { config } from '../../config/env.js';
import { aiError } from './ai-errors.js';
import { createGeminiProvider } from './gemini.provider.js';

/**
 * The app talks to AI only through this module. To change providers, add another
 * create<Name>Provider implementing the same contract (ai-errors.js) and select it here.
 */
let defaultProvider;

export function getDefaultAiProvider() {
  defaultProvider ??= config.gemini.apiKey && config.gemini.model ? createGeminiProvider(config.gemini) : unconfiguredProvider();
  return defaultProvider;
}

function unconfiguredProvider() {
  return {
    name: 'none',
    isConfigured: false,
    models: [],
    generateJson: async () => {
      throw aiError('NOT_CONFIGURED');
    },
  };
}

export { aiError } from './ai-errors.js';
