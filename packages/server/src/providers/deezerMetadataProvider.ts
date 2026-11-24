import type {
  DifficultyLevel,
  MusicProvider,
  PlayablePreviewResult,
  ProviderSearchOptions,
  ProviderSongMetadata,
  Song
} from '@songgest/shared';
import { DIFFICULTY_CONFIGS, getDifficultyFromPopularity } from '@songgest/shared';

// Known Deezer genre IDs for top categories
export const DEEZER_GENRE_MAP: Record<string, number> = {
  'pop': 132,
  'rock': 152,
  'rap': 116,
  'hip hop': 116,
  'rap/hip hop': 116,
  'dance': 113,
  'electronic': 106,
  'electro': 106,
  'r&b': 165,
  'alternative': 85,
  'folk': 466,
  'reggae': 144,
  'jazz': 129,
  'classical': 98,
  'metal': 464,
  'soul': 169,
  'soul & funk': 169,
  'funk': 169,
  'blues': 153,
  'latin': 197
};

export interface DeezerTrackItem {
  id: number;
  title: string;
  title_short?: string;
  link?: string;
  duration?: number;
  rank?: number;
  preview?: string;
  isrc?: string;
  release_date?: string;
  artist?: {
    id?: number;
    name?: string;
    picture_medium?: string;
  };
  album?: {
    id?: number;
    title?: string;
    cover_medium?: string;
    cover_big?: string;
    cover_xl?: string;
    release_date?: string;
  };
  genres?: {
    data?: Array<{ id: number; name: string }>;
  };
}

export interface DeezerPlaylistItem {
  id: number;
  title: string;
  link?: string;
  nb_tracks?: number;
}

export interface DeezerSearchResponse<T = DeezerTrackItem> {
  data?: T[];
  total?: number;
  next?: string;
  error?: {
    type?: string;
    message?: string;
    code?: number;
  };
}

export interface DeezerProviderOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class DeezerMetadataProvider implements MusicProvider {
  public readonly providerId = 'deezer';
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly cache: Map<string, { item: ProviderSongMetadata; expiresAt: number }> = new Map();

  constructor(options: DeezerProviderOptions = {}) {
    this.baseUrl = options.baseUrl || 'https://api.deezer.com';
    this.fetchFn = options.fetchFn || fetch;
    this.timeoutMs = options.timeoutMs || 5000;
  }

  /**
   * Searches the Deezer catalog matching query, artist, genre, year, or difficulty filters.
   * Only returns tracks that have valid, authentic audio previews.
   */
  public async searchSongs(query: string, options?: ProviderSearchOptions): Promise<Song[]> {
    const limit = Math.min(100, Math.max(1, options?.limit ?? 30));
    const offset = Math.max(0, options?.offset ?? 0);

    let apiUrl: string;
    let genreHint = options?.genre;

    const trimmedArtist = options?.artist?.trim();
    const trimmedQuery = query?.trim();

    // Detect targeted musical era
    let eraKeyword = '';
    let eraMidYear = 0;
    if (options?.yearMin !== undefined && options?.yearMax !== undefined) {
      if (options.yearMin >= 1970 && options.yearMax <= 1979) { eraKeyword = '70s'; eraMidYear = 1975; }
      else if (options.yearMin >= 1980 && options.yearMax <= 1989) { eraKeyword = '80s'; eraMidYear = 1985; }
      else if (options.yearMin >= 1990 && options.yearMax <= 1999) { eraKeyword = '90s'; eraMidYear = 1995; }
      else if (options.yearMin >= 2000 && options.yearMax <= 2009) { eraKeyword = '00s'; eraMidYear = 2005; }
      else if (options.yearMin >= 2010 && options.yearMax <= 2019) { eraKeyword = '10s'; eraMidYear = 2015; }
      else if (options.yearMin >= 2020) { eraKeyword = '20s'; eraMidYear = 2023; }
    }

    if (trimmedArtist && trimmedQuery) {
      const q = `${trimmedArtist} ${trimmedQuery}`;
      apiUrl = `${this.baseUrl}/search?q=${encodeURIComponent(q)}&limit=${limit}&index=${offset}`;
    } else if (trimmedArtist) {
      apiUrl = `${this.baseUrl}/search?q=${encodeURIComponent(trimmedArtist)}&limit=${limit}&index=${offset}`;
    } else if (trimmedQuery) {
      apiUrl = `${this.baseUrl}/search?q=${encodeURIComponent(trimmedQuery)}&limit=${limit}&index=${offset}`;
    } else if (eraKeyword) {
      // Query authentic Deezer era playlist for curated iconic hits of that decade
      const playlistQuery = genreHint && genreHint.toLowerCase() !== 'all' && genreHint.toLowerCase() !== 'any'
        ? `${genreHint} ${eraKeyword} hits`
        : `${eraKeyword} hits`;
      const plSearch = await this.executeRequest<DeezerSearchResponse<DeezerPlaylistItem>>(
        `${this.baseUrl}/search/playlist?q=${encodeURIComponent(playlistQuery)}&limit=3`
      );
      if (plSearch && plSearch.data && plSearch.data.length > 0) {
        const topPlaylist = plSearch.data[0];
        apiUrl = `${this.baseUrl}/playlist/${topPlaylist.id}/tracks?limit=${limit}&index=${offset}`;
      } else {
        apiUrl = `${this.baseUrl}/search?q=${encodeURIComponent(playlistQuery)}&limit=${limit}&index=${offset}`;
      }
    } else if (genreHint && genreHint.toLowerCase() !== 'all' && genreHint.toLowerCase() !== 'any') {
      const normalizedGenre = genreHint.toLowerCase().trim();
      const genreId = DEEZER_GENRE_MAP[normalizedGenre];
      if (genreId !== undefined) {
        apiUrl = `${this.baseUrl}/chart/${genreId}/tracks?limit=${limit}&index=${offset}`;
      } else {
        apiUrl = `${this.baseUrl}/search?q=${encodeURIComponent(genreHint)}&limit=${limit}&index=${offset}`;
      }
    } else {
      // Default to global top chart
      apiUrl = `${this.baseUrl}/chart/0/tracks?limit=${limit}&index=${offset}`;
      genreHint = 'Pop';
    }

    const data = await this.executeRequest<DeezerSearchResponse>(apiUrl);
    if (!data || !data.data || data.data.length === 0) {
      return [];
    }

    const songs: Song[] = [];

    for (const rawItem of data.data) {
      // TASK 5: Keep metadata retrieval separate from audio playback.
      // Do not mark tracks playable unless an authorized audio preview exists.
      if (!rawItem.preview || typeof rawItem.preview !== 'string' || !rawItem.preview.startsWith('http')) {
        continue;
      }

      const song = this.mapTrackToSong(rawItem, genreHint);
      if (!song) continue;

      // When an era is targeted and track release_date is missing, estimate with era midpoint
      if (song.releaseYear === 0 && eraMidYear > 0) {
        song.releaseYear = eraMidYear;
      }

      // Apply difficulty filter if requested
      if (options?.difficulty && options.difficulty !== ('all' as DifficultyLevel)) {
        const diffConfig = DIFFICULTY_CONFIGS[options.difficulty];
        if (diffConfig) {
          if (song.popularityScore < diffConfig.popularityMin || song.popularityScore > diffConfig.popularityMax) {
            continue;
          }
        }
      }

      // Apply release year range filter if requested
      if (options?.yearMin !== undefined && song.releaseYear > 0 && song.releaseYear < options.yearMin) {
        continue;
      }
      if (options?.yearMax !== undefined && song.releaseYear > 0 && song.releaseYear > options.yearMax) {
        continue;
      }

      // Apply language filter if requested
      if (options?.language && options.language !== 'all' && options.language !== 'any') {
        if (song.language.toLowerCase() !== options.language.toLowerCase()) {
          continue;
        }
      }

      songs.push(song);
    }

    return songs;
  }

  /**
   * Retrieves full song metadata by Deezer track ID.
   */
  public async getSongMetadata(providerTrackId: string): Promise<ProviderSongMetadata | null> {
    const cleanId = String(providerTrackId).replace(/^deezer_/, '');
    if (!cleanId || cleanId === 'undefined' || cleanId === 'null') {
      return null;
    }

    // Check in-memory cache first
    const cached = this.cache.get(cleanId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.item;
    }

    const url = `${this.baseUrl}/track/${cleanId}`;
    const rawTrack = await this.executeRequest<DeezerTrackItem & { error?: unknown }>(url);

    if (!rawTrack || (rawTrack as any).error || !rawTrack.title) {
      return null;
    }

    const metadata = this.mapTrackToMetadata(rawTrack);
    if (metadata) {
      this.cache.set(cleanId, {
        item: metadata,
        expiresAt: Date.now() + 60 * 60 * 1000 // 1 hour TTL
      });
    }

    return metadata;
  }

  /**
   * Resolves a streamable audio preview resource for a track.
   * Does NOT map Deezer tracks to local fixtures.
   */
  public async getPlayablePreview(providerTrackId: string): Promise<PlayablePreviewResult | null> {
    const cleanId = String(providerTrackId).replace(/^deezer_/, '');
    const url = `${this.baseUrl}/track/${cleanId}`;
    const rawTrack = await this.executeRequest<DeezerTrackItem & { error?: unknown }>(url);

    if (!rawTrack || !rawTrack.preview || !rawTrack.preview.startsWith('http')) {
      return null;
    }

    return {
      previewUrl: rawTrack.preview,
      previewOffsetSec: 0.0,
      durationSec: 30.0,
      format: 'audio/mpeg',
      isLocalFixture: false
    };
  }

  /**
   * Validates whether a playable preview is currently available and accessible.
   */
  public async validatePreviewAvailability(providerTrackId: string): Promise<boolean> {
    const cleanId = String(providerTrackId).replace(/^deezer_/, '');
    const url = `${this.baseUrl}/track/${cleanId}`;
    const rawTrack = await this.executeRequest<DeezerTrackItem & { error?: unknown }>(url);

    if (!rawTrack || !rawTrack.preview || !rawTrack.preview.startsWith('http')) {
      return false;
    }

    return true;
  }

  /**
   * Clears the in-memory metadata cache.
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Safely executes an HTTP request to the Deezer API with timeout and error handling.
   */
  private async executeRequest<T>(url: string): Promise<T | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        return null;
      }

      const json = await response.json();
      if (json && (json as any).error) {
        // Deezer returned an API error (e.g. Quota limit exceeded)
        const err = (json as any).error;
        console.warn(`[DeezerMetadataProvider] API error: ${err.message || err.type || 'Unknown'} (code ${err.code})`);
        return null;
      }

      return json as T;
    } catch (err: unknown) {
      // Abort or network failure
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Maps a raw Deezer track item to Songgest Song interface.
   */
  public mapTrackToSong(item: DeezerTrackItem, genreHint?: string): Song | null {
    if (!item || !item.id || !item.title) {
      return null;
    }

    const rank = typeof item.rank === 'number' ? item.rank : 0;
    const popularityScore = Math.min(100, Math.max(0, Math.round(rank / 10000)));

    let releaseYear = 0;
    if (item.release_date && typeof item.release_date === 'string') {
      const parsed = parseInt(item.release_date.slice(0, 4), 10);
      if (!isNaN(parsed) && parsed > 1900) releaseYear = parsed;
    } else if (item.album?.release_date && typeof item.album.release_date === 'string') {
      const parsed = parseInt(item.album.release_date.slice(0, 4), 10);
      if (!isNaN(parsed) && parsed > 1900) releaseYear = parsed;
    }

    const genre =
      item.genres?.data?.[0]?.name ||
      genreHint ||
      'Pop';

    return {
      id: String(item.id),
      isrc: item.isrc ?? undefined,
      title: item.title,
      artist: item.artist?.name || 'Unknown Artist',
      album: item.album?.title ?? undefined,
      releaseYear,
      genre,
      subgenres: item.genres?.data?.slice(1).map((g) => g.name) || [],
      language: 'en',
      popularityScore,
      difficulty: getDifficultyFromPopularity(popularityScore),
      previewUrl: item.preview || '',
      previewOffsetSec: 0.0,
      albumArtUrl: item.album?.cover_medium || item.album?.cover_big || undefined,
      externalUrl: item.link || `https://www.deezer.com/track/${item.id}`
    };
  }

  /**
   * Maps a raw Deezer track item to ProviderSongMetadata interface.
   */
  public mapTrackToMetadata(item: DeezerTrackItem): ProviderSongMetadata | null {
    if (!item || !item.id || !item.title) {
      return null;
    }

    const rank = typeof item.rank === 'number' ? item.rank : 0;
    const popularityScore = Math.min(100, Math.max(0, Math.round(rank / 10000)));

    let releaseYear = 0;
    if (item.release_date && typeof item.release_date === 'string') {
      const parsed = parseInt(item.release_date.slice(0, 4), 10);
      if (!isNaN(parsed) && parsed > 1900) releaseYear = parsed;
    } else if (item.album?.release_date && typeof item.album.release_date === 'string') {
      const parsed = parseInt(item.album.release_date.slice(0, 4), 10);
      if (!isNaN(parsed) && parsed > 1900) releaseYear = parsed;
    }

    const genre = item.genres?.data?.[0]?.name || 'Pop';

    return {
      id: String(item.id),
      isrc: item.isrc ?? undefined,
      title: item.title,
      artist: item.artist?.name || 'Unknown Artist',
      album: item.album?.title ?? undefined,
      releaseYear,
      genre,
      subgenres: item.genres?.data?.slice(1).map((g) => g.name) || [],
      language: 'en',
      popularityScore,
      durationMs: item.duration ? item.duration * 1000 : 30000,
      albumArtUrl: item.album?.cover_medium || item.album?.cover_big || undefined,
      externalUrl: item.link || `https://www.deezer.com/track/${item.id}`
    };
  }
}

export const deezerMetadataProvider = new DeezerMetadataProvider();
