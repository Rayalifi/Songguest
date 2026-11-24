import type { PreviewProvider, PreviewResult, PreviewTrackInput } from '@songgest/shared';

export class SpotifyNativePreviewProvider implements PreviewProvider {
  public readonly providerId = 'spotify-native';

  public async findPreview(track: PreviewTrackInput): Promise<PreviewResult> {
    if (track.spotifyPreviewUrl && typeof track.spotifyPreviewUrl === 'string' && track.spotifyPreviewUrl.startsWith('http')) {
      return {
        available: true,
        previewUrl: track.spotifyPreviewUrl,
        provider: this.providerId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour preview expiry window
        format: 'audio/mpeg'
      };
    }

    return { available: false };
  }
}

export const spotifyNativePreviewProvider = new SpotifyNativePreviewProvider();
