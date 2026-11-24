import type { PreviewProvider, PreviewResult, PreviewTrackInput } from '@songgest/shared';
import { spotifyNativePreviewProvider } from './spotifyNativePreviewProvider.js';
import { itunesPreviewProvider } from './itunesPreviewProvider.js';
import { deezerPreviewProvider } from './deezerPreviewProvider.js';

export class CompositePreviewProvider implements PreviewProvider {
  public readonly providerId = 'composite-preview';
  private providers: PreviewProvider[];

  constructor(providers?: PreviewProvider[]) {
    this.providers = providers ?? [
      spotifyNativePreviewProvider,
      itunesPreviewProvider,
      deezerPreviewProvider
    ];
  }

  public async findPreview(track: PreviewTrackInput): Promise<PreviewResult> {
    for (const provider of this.providers) {
      try {
        const result = await provider.findPreview(track);
        if (result.available && result.previewUrl) {
          return result;
        }
      } catch {
        // Continue to next provider in chain
      }
    }

    return { available: false };
  }
}

export const compositePreviewProvider = new CompositePreviewProvider();
