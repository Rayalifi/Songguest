import type { DifficultyLevel, GuessDuration } from './game.js';

export interface Song {
  id: string;
  isrc?: string;
  title: string;
  artist: string;
  album?: string;
  releaseYear: number;
  genre: string;
  subgenres: string[];
  language: string;
  popularityScore: number; // 0 to 100
  difficulty?: DifficultyLevel; // Derived from popularityScore
  previewUrl: string;
  previewOffsetSec: number;
  albumArtUrl?: string;
  externalUrl?: string;
}

export interface SongFilterCriteria {
  genres?: string[];
  artist?: string;
  releaseYearRange?: [number, number];
  language?: string;
  difficulty?: DifficultyLevel;
  guessDuration?: GuessDuration;
}

export interface SongQueryFilter {
  playlistId?: string;
  difficulty?: DifficultyLevel;
  genre?: string;
  artist?: string;
  language?: string;
  yearMin?: number;
  yearMax?: number;
  popularityMin?: number;
  popularityMax?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SongAutocompleteItem {
  id: string;
  title: string;
  artist: string;
  displayText: string;
}

export interface FilterOptionsPayload {
  genres: string[];
  languages: string[];
  artists: string[];
  yearMin: number;
  yearMax: number;
}
