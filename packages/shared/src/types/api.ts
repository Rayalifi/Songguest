import type {
  DifficultyLevel,
  GameMode,
  GameSessionSummary,
  GuessDuration,
  GuessResult,
  RoundTicket,
  SessionSourceType
} from './game.js';
import type { Song, SongAutocompleteItem, SongFilterCriteria } from './song.js';

export interface CreateSessionRequest {
  sourceType?: SessionSourceType;
  playlistId?: string;
  playlistName?: string;
  mode?: GameMode;
  difficulty?: DifficultyLevel;
  guessDuration?: GuessDuration;
  filters?: SongFilterCriteria;
  roundsCount?: number;
  genre?: string;
  artist?: string;
  language?: string;
  yearMin?: number;
  yearMax?: number;
}

export interface CreateSessionResponse {
  sessionId: string;
  sourceType?: SessionSourceType;
  playlistName?: string;
  mode: GameMode;
  difficulty: DifficultyLevel;
  guessDuration: GuessDuration;
  totalRounds: number;
  currentRound: RoundTicket;
}

export interface SubmitGuessRequest {
  ticketId?: string;
  ticket?: string;
  guessText: string;
  reactionTimeMs: number;
  advanceOnWrong?: boolean;
  isTimeout?: boolean;
}

export interface SubmitGuessResponse extends GuessResult {
  roundNumber: number;
  totalScore: number;
  isSessionCompleted: boolean;
  nextRound?: RoundTicket;
}

export interface SkipRoundRequest {
  ticketId: string;
}

export interface SkipRoundResponse {
  roundNumber: number;
  stageIndex: number;
  durationSec: GuessDuration;
  isRevealed: boolean;
  pointsAwarded?: number;
  totalScore?: number;
  currentStreak?: number;
  isSessionCompleted?: boolean;
  revealedSong?: {
    id: string;
    title: string;
    artist: string;
    album?: string;
    releaseYear: number;
    genre: string;
    previewUrl?: string;
    albumArtUrl?: string;
    externalUrl?: string;
  };
}

export interface SpotifyTrackItem {
  id: string;
  title: string;
  artist: string;
  album?: string;
  releaseYear: number;
  popularityScore: number;
  hasPlayablePreview: boolean;
  previewUrl?: string;
  previewProvider?: string;
  externalSpotifyUrl?: string;
  albumArtUrl?: string;
}

export interface SpotifyPlaylistMetadata {
  id: string;
  name: string;
  spotifyUrl: string;
  description?: string;
  ownerName?: string;
  totalTracks: number;
  playableCount: number;
  unplayableCount: number;
  artists: string[];
  genres: string[];
  yearMin: number;
  yearMax: number;
  tracks: SpotifyTrackItem[];
  isMockProvider?: boolean;
  notice?: string;
}

export interface SpotifyImportRequest {
  url: string;
}

export interface SpotifyImportResponse {
  success: boolean;
  playlist: {
    id: string;
    name: string;
    spotifyUrl: string;
    description?: string;
    ownerName?: string;
    artists?: string[];
    genres?: string[];
    yearMin?: number;
    yearMax?: number;
    totalTracks?: number;
    playableCount?: number;
    unplayableCount?: number;
    tracks?: SpotifyTrackItem[];
    isMockProvider?: boolean;
    notice?: string;
  };
  totalTracks: number;
  playableTracks: number;
  unavailableTracks: number;
  tracks: SpotifyTrackItem[];
  isMockProvider?: boolean;
  notice?: string;
}

export interface SpotifyAuthUrlResponse {
  authUrl: string;
  state: string;
}

export interface SpotifyAuthStatusResponse {
  isConnected: boolean;
  spotifyUserId?: string;
  displayName?: string;
}

export interface SessionSummaryResponse {
  summary: GameSessionSummary;
}

export interface AutocompleteResponse {
  query: string;
  results: SongAutocompleteItem[];
}

export interface ApiErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  availableCount?: number;
}

