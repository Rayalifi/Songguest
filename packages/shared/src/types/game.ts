export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'expert' | 'impossible' | 'normal';

export type GuessDuration = 0.1 | 0.5 | 2.0 | 8.0 | 15.0;

export type GameMode = 'quick_play' | 'spotify_playlist' | 'arcade' | 'survival' | 'progressive';

export type SessionSourceType = 'QUICK_PLAY' | 'SPOTIFY_PLAYLIST';

export type RoundStatus =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'playing'
  | 'evaluating'
  | 'completed'
  | 'timeout';

export interface ProgressiveStage {
  stageIndex: number;
  durationSec: GuessDuration;
  label: string;
  multiplier: number;
  description: string;
}

export interface RoundTicket {
  roundId?: string;
  roundNumber: number;
  ticket?: string;
  ticketId: string;
  stageIndex: number;
  durationSec: GuessDuration;
  expiresAt: number;
}

export interface GuessSubmission {
  ticket: string;
  guessText: string;
  reactionTimeMs: number;
  advanceOnWrong?: boolean;
}

export interface GuessResult {
  isCorrect: boolean;
  isPartial: boolean;
  pointsAwarded: number;
  currentStreak: number;
  reactionTimeMs: number;
  stageIndex?: number;
  isRevealed?: boolean;
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

export interface RoundRecord {
  roundNumber: number;
  songTitle: string;
  songArtist: string;
  isCorrect: boolean;
  isPartial: boolean;
  pointsAwarded: number;
  durationSec: GuessDuration;
  stageIndex?: number;
  reactionTimeMs: number;
}

export interface GameSessionSummary {
  sessionId: string;
  sourceType?: SessionSourceType;
  playlistName?: string;
  mode: GameMode;
  difficulty: DifficultyLevel;
  guessDuration: GuessDuration;
  totalScore: number;
  totalRounds: number;
  correctRounds: number;
  accuracyPercentage: number;
  highestStreak: number;
  rounds: RoundRecord[];
}

export interface GameHistoryRecord {
  id: string;
  sessionId: string;
  sourceType?: SessionSourceType;
  playlistName?: string | null;
  mode: GameMode;
  difficulty: DifficultyLevel;
  guessDuration: GuessDuration;
  genre?: string | null;
  finalScore: number;
  roundsPlayed: number;
  correctAnswers: number;
  accuracy: number;
  highestStreak: number;
  completedAt: string;
}

export interface PlayerHistoryStats {
  gamesPlayed: number;
  highestScore: number;
  averageScore: number;
  overallAccuracy: number;
  highestStreak: number;
  recentGames: GameHistoryRecord[];
}

