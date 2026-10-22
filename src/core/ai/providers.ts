import type { Secrets } from '../storage/secrets';
import type { Settings } from '../storage/settings';
import { GeminiProvider } from './provider-gemini';
import { normalizeBaseUrl, OpenAICompatProvider } from './provider-openai-compat';
import { ProviderError, type Provider } from './types';

export function originPattern(baseUrl: string): string | null {
  try {
    const u = new URL(normalizeBaseUrl(baseUrl));
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

/** Background only: builds the configured provider; throws `no-key` / `no-permission`. */
export async function createProvider(settings: Settings, secrets: Secrets): Promise<Provider> {
  if (settings.provider === 'gemini') {
    if (!secrets.geminiKey) throw new ProviderError('no-key', 'no Gemini API key');
    return new GeminiProvider({ apiKey: secrets.geminiKey, model: settings.gemini.model });
  }
  const pattern = originPattern(settings.openai.baseUrl);
  if (!pattern) throw new ProviderError('no-key', 'invalid base URL');
  // FR-A3: custom hosts are optional permissions granted from the options page.
  const granted = await browser.permissions.contains({ origins: [pattern] }).catch(() => false);
  if (!granted) throw new ProviderError('no-permission', `no host permission for ${pattern}`);
  return new OpenAICompatProvider({
    baseUrl: settings.openai.baseUrl,
    apiKey: secrets.openaiKey ?? '',
    model: settings.openai.model,
  });
}

export function providerModel(settings: Settings): string {
  return settings.provider === 'gemini' ? settings.gemini.model : settings.openai.model;
}
