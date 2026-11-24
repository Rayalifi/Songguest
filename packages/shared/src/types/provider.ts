import type { DifficultyLevel, GuessDuration } from './game.js';
import type { Song } from './song.js';

export interface ProviderSearchOptions {
  genre?: string;
  artist?: string;
  language?: string;
  yearMin?: number;
  yearMax?: number;
  limit?: number;
  offset?: number;
  difficulty?: DifficultyLevel;
}

export interface ProviderSongMetadata {
  id: string;
  isrc?: string;
  title: string;
  artist: string;
  album?: string;
  releaseYear: number;
  genre: string;
  subgenres: string[];
  language: string;
  popularityScore: number;
  durationMs?: number;
  albumArtUrl?: string;
  externalUrl?: string;
}

export interface PlayablePreviewResult {
  previewUrl: string;
  previewOffsetSec: number;
  durationSec: number;
  format: 'audio/wav' | 'audio/mpeg' | 'audio/aac';
  isLocalFixture: boolean;
}

export interface PreviewTrackInput {
  id: string;
  title: string;
  artist: string;
  album?: string;
  releaseYear?: number;
  isrc?: string;
  spotifyPreviewUrl?: string | null;
}

export interface PreviewResult {
  available: boolean;
  previewUrl?: string;
  provider?: string;
  expiresAt?: Date;
  format?: 'audio/wav' | 'audio/mpeg' | 'audio/aac';
}

export interface PreviewProvider {
  readonly providerId: string;
  findPreview(track: PreviewTrackInput): Promise<PreviewResult>;
}

export interface MusicProvider {
  /**
   * Unique identifier of the provider implementation (e.g., 'local-fixtures', 'itunes-search', 'deezer').
   */
  readonly providerId: string;

  /**
   * Searches the provider catalog matching title, artist, or metadata filters.
   */
  searchSongs(query: string, options?: ProviderSearchOptions): Promise<Song[]>;

  /**
   * Retrieves full song metadata by provider track ID.
   */
  getSongMetadata(providerTrackId: string): Promise<ProviderSongMetadata | null>;

  /**
   * Resolves a streamable audio preview resource for a track.
   */
  getPlayablePreview(providerTrackId: string): Promise<PlayablePreviewResult | null>;

  /**
   * Validates whether a playable preview is currently available and accessible.
   */
  validatePreviewAvailability(providerTrackId: string): Promise<boolean>;
}
