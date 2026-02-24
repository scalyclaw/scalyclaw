import type { ModelProvider } from './provider.js';

const providers = new Map<string, ModelProvider>();

export function registerProvider(provider: ModelProvider, idOverride?: string): void {
  providers.set(idOverride ?? provider.id, provider);
}

export function getProvider(providerId: string): ModelProvider {
  const p = providers.get(providerId);
  if (!p) throw new Error(`Model provider "${providerId}" not registered`);
  return p;
}
