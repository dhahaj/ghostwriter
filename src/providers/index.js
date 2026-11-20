// Provider registry. To add one (OpenAI, Anthropic, local llama.cpp...), write a
// module exporting create<Name>Provider(env) that returns
//   { name, model, complete({ system, user, maxTokens, signal, apiKey, model }) -> { text } }
// and register it below.
import { createGeminiProvider } from './gemini.js';
import { createMockProvider } from './mock.js';

const FACTORIES = {
  gemini: (env) => createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
  mock: () => createMockProvider(),
};

export function createProvider(name, env = process.env) {
  const factory = FACTORIES[(name || 'gemini').toLowerCase()];
  if (!factory) throw new Error(`Unknown provider "${name}". Known: ${Object.keys(FACTORIES).join(', ')}`);
  return factory(env);
}

export const providerNames = Object.keys(FACTORIES);
