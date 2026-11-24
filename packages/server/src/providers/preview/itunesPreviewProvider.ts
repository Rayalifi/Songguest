import { calculateStringSimilarity, normalizeSongString } from '@songgest/shared';
import type { PreviewProvider, PreviewResult, PreviewTrackInput } from '@songgest/shared';

interface ITunesTrackResult {
  trackName?: string;
  artistName?: string;
  previewUrl?: string;
  artworkUrl100?: string;
}

interface ITunesSearchResponse {
  resultCount: number;
  results: ITunesTrackResult[];
}

export class ITunesPreviewProvider implements PreviewProvider {
  public readonly providerId = 'itunes';

  public async findPreview(track: PreviewTrackInput): Promise<PreviewResult> {
    const cleanTitle = normalizeSongString(track.title);
    const cleanArtist = normalizeSongString(track.artist);
    const searchTerm = `${cleanArtist} ${cleanTitle}`.trim();

    if (!searchTerm) {
      return { available: false };
    }

    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&limit=5`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Songgest/0.1.0'
        }
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return { available: false };
      }

      const data = (await response.json()) as ITunesSearchResponse;
      if (!data.results || data.results.length === 0) {
        return { available: false };
      }

      for (const item of data.results) {
        if (!item.previewUrl || !item.trackName || !item.artistName) {
          continue;
        }

        const titleSim = calculateStringSimilarity(track.title, item.trackName);
        const artistSim = calculateStringSimilarity(track.artist, item.artistName);

        const isTitleMatch =
          titleSim >= 0.70 ||
          normalizeSongString(item.trackName).includes(cleanTitle) ||
          cleanTitle.includes(normalizeSongString(item.trackName));

        const isArtistMatch =
          artistSim >= 0.60 ||
          normalizeSongString(item.artistName).includes(cleanArtist) ||
          cleanArtist.includes(normalizeSongString(item.artistName));

        if (isTitleMatch && isArtistMatch) {
          // Preview URLs on Apple CDN are signed/temporary; set a 2-hour validity window
          const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
          return {
            available: true,
            previewUrl: item.previewUrl,
            provider: this.providerId,
            expiresAt,
            format: 'audio/aac'
          };
        }
      }

      return { available: false };
    } catch {
      return { available: false };
    }
  }
}

export const itunesPreviewProvider = new ITunesPreviewProvider();
