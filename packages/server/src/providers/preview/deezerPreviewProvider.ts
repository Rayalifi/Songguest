import { calculateStringSimilarity, normalizeSongString } from '@songgest/shared';
import type { PreviewProvider, PreviewResult, PreviewTrackInput } from '@songgest/shared';

interface DeezerTrackItem {
  title?: string;
  artist?: {
    name?: string;
  };
  preview?: string;
}

interface DeezerSearchResponse {
  data?: DeezerTrackItem[];
}

export class DeezerPreviewProvider implements PreviewProvider {
  public readonly providerId = 'deezer';

  public async findPreview(track: PreviewTrackInput): Promise<PreviewResult> {
    const cleanTitle = normalizeSongString(track.title);
    const cleanArtist = normalizeSongString(track.artist);
    const query = `${cleanArtist} ${cleanTitle}`.trim();

    if (!query) {
      return { available: false };
    }

    try {
      const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json'
        }
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return { available: false };
      }

      const data = (await response.json()) as DeezerSearchResponse;
      if (!data.data || data.data.length === 0) {
        return { available: false };
      }

      for (const item of data.data) {
        if (!item.preview || !item.title || !item.artist?.name) {
          continue;
        }

        const titleSim = calculateStringSimilarity(track.title, item.title);
        const artistSim = calculateStringSimilarity(track.artist, item.artist.name);

        const isTitleMatch =
          titleSim >= 0.70 ||
          normalizeSongString(item.title).includes(cleanTitle) ||
          cleanTitle.includes(normalizeSongString(item.title));

        const isArtistMatch =
          artistSim >= 0.60 ||
          normalizeSongString(item.artist.name).includes(cleanArtist) ||
          cleanArtist.includes(normalizeSongString(item.artist.name));

        if (isTitleMatch && isArtistMatch) {
          const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
          return {
            available: true,
            previewUrl: item.preview,
            provider: this.providerId,
            expiresAt,
            format: 'audio/mpeg'
          };
        }
      }

      return { available: false };
    } catch {
      return { available: false };
    }
  }
}

export const deezerPreviewProvider = new DeezerPreviewProvider();
