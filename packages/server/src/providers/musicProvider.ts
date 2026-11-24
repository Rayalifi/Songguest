import type { MusicProvider } from '@songgest/shared';
import { localFixtureProvider } from './localFixtureProvider.js';
import { deezerMetadataProvider } from './deezerMetadataProvider.js';

class MusicProviderRegistry {
  private providers: Map<string, MusicProvider> = new Map();
  private activeProviderId = 'local-fixtures';

  constructor() {
    this.registerProvider(localFixtureProvider);
    this.registerProvider(deezerMetadataProvider);

    // In test environment, default to local-fixtures so integration tests test predictable local fixtures
    if (process.env.NODE_ENV !== 'test') {
      const envProvider = process.env.MUSIC_METADATA_PROVIDER || process.env.MUSIC_PROVIDER;
      if (envProvider && this.providers.has(envProvider)) {
        this.activeProviderId = envProvider;
      }
    }
  }

  public registerProvider(provider: MusicProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  public hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  public getRegisteredProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  public getProvider(providerId?: string): MusicProvider {
    const id = providerId ?? this.activeProviderId;
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Music provider '${id}' is not registered.`);
    }
    return provider;
  }

  public setActiveProvider(providerId: string): void {
    if (!this.providers.has(providerId)) {
      throw new Error(`Cannot set unknown provider '${providerId}' as active.`);
    }
    this.activeProviderId = providerId;
  }

  public getActiveProvider(): MusicProvider {
    return this.getProvider(this.activeProviderId);
  }

  public resetActiveProvider(): void {
    if (process.env.NODE_ENV === 'test') {
      this.activeProviderId = 'local-fixtures';
      return;
    }
    const envProvider = process.env.MUSIC_METADATA_PROVIDER || process.env.MUSIC_PROVIDER;
    this.activeProviderId = (envProvider && this.providers.has(envProvider)) ? envProvider : 'local-fixtures';
  }
}

export const musicProviderRegistry = new MusicProviderRegistry();

