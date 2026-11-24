import {
  DIFFICULTY_LEVELS,
  GUESS_DURATIONS,
  type DifficultyLevel,
  type GameMode,
  type GuessDuration,
  type SessionSourceType
} from '@songgest/shared';

const VALID_MODES: GameMode[] = ['quick_play', 'spotify_playlist', 'arcade', 'survival', 'progressive'];
const VALID_SOURCE_TYPES: SessionSourceType[] = ['QUICK_PLAY', 'SPOTIFY_PLAYLIST'];
const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const SPOTIFY_PLAYLIST_ID_REGEX = /^[a-zA-Z0-9]{15,35}$/;

export class ValidationError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function validateId(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !ID_REGEX.test(value.trim())) {
    throw new ValidationError(
      'INVALID_IDENTIFIER',
      `Field '${fieldName}' must be a valid alphanumeric identifier (max 64 characters).`
    );
  }
  return value.trim();
}

const MAX_URL_LENGTH = 500;

export function validateSpotifyUrl(urlInput: unknown): string {
  if (typeof urlInput !== 'string' || !urlInput.trim()) {
    throw new ValidationError(
      'INVALID_SPOTIFY_URL',
      'A valid Spotify playlist URL is required.'
    );
  }

  const rawUrl = urlInput.trim();

  if (rawUrl.length > MAX_URL_LENGTH) {
    throw new ValidationError(
      'INVALID_SPOTIFY_URL',
      `URL exceeds maximum allowed length of ${MAX_URL_LENGTH} characters.`
    );
  }

  // Reject other Spotify resource types explicitly
  if (
    rawUrl.includes('/track/') ||
    rawUrl.includes('spotify:track:') ||
    rawUrl.includes('/album/') ||
    rawUrl.includes('spotify:album:') ||
    rawUrl.includes('/artist/') ||
    rawUrl.includes('spotify:artist:') ||
    rawUrl.includes('/show/') ||
    rawUrl.includes('/episode/')
  ) {
    throw new ValidationError(
      'INVALID_SPOTIFY_URL',
      'The provided URL is not a Spotify playlist. Only playlist URLs are supported.'
    );
  }

  // Support https://open.spotify.com/playlist/{id} and spotify:playlist:{id}
  let playlistId = '';

  const httpsMatch = rawUrl.match(/(?:https?:\/\/)?open\.spotify\.com\/(?:user\/[^/]+\/)?playlist\/([a-zA-Z0-9]+)/);
  if (httpsMatch && httpsMatch[1]) {
    playlistId = httpsMatch[1];
  } else {
    const uriMatch = rawUrl.match(/spotify:playlist:([a-zA-Z0-9]+)/);
    if (uriMatch && uriMatch[1]) {
      playlistId = uriMatch[1];
    }
  }

  if (!playlistId || !SPOTIFY_PLAYLIST_ID_REGEX.test(playlistId)) {
    throw new ValidationError(
      'INVALID_SPOTIFY_URL',
      'The provided URL does not contain a valid Spotify playlist identifier.'
    );
  }

  return playlistId;
}

export interface ValidatedSessionInput {
  sourceType: SessionSourceType;
  playlistId?: string;
  playlistName?: string;
  mode: GameMode;
  difficulty?: DifficultyLevel;
  guessDuration: GuessDuration;
  roundsCount: number;
  genre?: string;
  artist?: string;
  language?: string;
  yearMin?: number;
  yearMax?: number;
  provider?: string;
  providerFallback?: boolean;
}

export function validateSessionInput(body: unknown): ValidatedSessionInput {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('INVALID_REQUEST_BODY', 'Request body must be a valid JSON object.');
  }

  const b = body as Record<string, unknown>;

  // Source type validation
  let sourceType: SessionSourceType = 'QUICK_PLAY';
  if (b.sourceType !== undefined) {
    if (typeof b.sourceType !== 'string' || !VALID_SOURCE_TYPES.includes(b.sourceType as SessionSourceType)) {
      throw new ValidationError(
        'INVALID_SOURCE_TYPE',
        `sourceType must be one of: ${VALID_SOURCE_TYPES.join(', ')}.`
      );
    }
    sourceType = b.sourceType as SessionSourceType;
  }

  // Playlist identifiers
  let playlistId: string | undefined;
  if (b.playlistId !== undefined && b.playlistId !== null) {
    playlistId = validateId(b.playlistId, 'playlistId');
  }

  let playlistName: string | undefined;
  if (b.playlistName !== undefined && b.playlistName !== null) {
    if (typeof b.playlistName !== 'string' || b.playlistName.length > 150) {
      throw new ValidationError('INVALID_PLAYLIST_NAME', 'playlistName must be a string up to 150 characters.');
    }
    playlistName = b.playlistName.trim() || undefined;
  }

  // Mode validation
  let mode: GameMode = 'quick_play';
  if (b.mode !== undefined) {
    if (typeof b.mode !== 'string' || !VALID_MODES.includes(b.mode as GameMode)) {
      throw new ValidationError(
        'INVALID_MODE',
        `Mode must be one of: ${VALID_MODES.join(', ')}.`
      );
    }
    mode = b.mode as GameMode;
  }

  // Difficulty validation: for QUICK_PLAY, default to 'medium'. For SPOTIFY_PLAYLIST, only apply when explicitly specified.
  let difficulty: DifficultyLevel | undefined = sourceType === 'SPOTIFY_PLAYLIST' ? undefined : 'medium';
  if (b.difficulty !== undefined && b.difficulty !== null && b.difficulty !== '') {
    if (typeof b.difficulty !== 'string' || (!DIFFICULTY_LEVELS.includes(b.difficulty as DifficultyLevel) && b.difficulty !== 'all')) {
      // Allow 'normal' as alias for 'medium'
      if (b.difficulty === 'normal') {
        difficulty = 'medium';
      } else {
        throw new ValidationError(
          'INVALID_DIFFICULTY',
          `Difficulty must be one of: ${DIFFICULTY_LEVELS.join(', ')}.`
        );
      }
    } else if (b.difficulty !== 'all') {
      difficulty = b.difficulty as DifficultyLevel;
    }
  }

  // Guess duration validation: starts at 0.1s for progressive revelation
  let guessDuration: GuessDuration = 0.1;
  if (b.guessDuration !== undefined) {
    const durNum = Number(b.guessDuration);
    if (!GUESS_DURATIONS.includes(durNum as GuessDuration)) {
      throw new ValidationError(
        'INVALID_GUESS_DURATION',
        `Guess duration must be one of: ${GUESS_DURATIONS.join(', ')} seconds.`
      );
    }
    guessDuration = durNum as GuessDuration;
  }

  // Rounds count validation
  let roundsCount = 5;
  if (b.roundsCount !== undefined) {
    const rCount = Number(b.roundsCount);
    if (!Number.isInteger(rCount) || rCount < 1 || rCount > 20) {
      throw new ValidationError(
        'INVALID_ROUNDS_COUNT',
        'Rounds count must be an integer between 1 and 20.'
      );
    }
    roundsCount = rCount;
  }


  // Genre validation
  let genre: string | undefined;
  if (b.genre !== undefined && b.genre !== null) {
    if (typeof b.genre !== 'string' || b.genre.length > 100) {
      throw new ValidationError('INVALID_GENRE', 'Genre must be a string up to 100 characters.');
    }
    const trimmed = b.genre.trim();
    if (trimmed && trimmed.toLowerCase() !== 'all' && trimmed.toLowerCase() !== 'any') {
      genre = trimmed;
    }
  }

  // Artist validation
  let artist: string | undefined;
  if (b.artist !== undefined && b.artist !== null) {
    if (typeof b.artist !== 'string' || b.artist.length > 100) {
      throw new ValidationError('INVALID_ARTIST', 'Artist must be a string up to 100 characters.');
    }
    const trimmed = b.artist.trim();
    if (trimmed) {
      artist = trimmed;
    }
  }

  // Language validation
  let language: string | undefined;
  if (b.language !== undefined && b.language !== null) {
    if (typeof b.language !== 'string' || b.language.length > 20) {
      throw new ValidationError('INVALID_LANGUAGE', 'Language must be a string up to 20 characters.');
    }
    const trimmed = b.language.trim();
    if (trimmed && trimmed.toLowerCase() !== 'all' && trimmed.toLowerCase() !== 'any') {
      language = trimmed;
    }
  }

  // Release year range validation
  let yearMin: number | undefined;
  let yearMax: number | undefined;

  if (b.yearMin !== undefined && b.yearMin !== null && b.yearMin !== '') {
    const yMin = Number(b.yearMin);
    if (!Number.isInteger(yMin) || yMin < 1900 || yMin > 2100) {
      throw new ValidationError('INVALID_YEAR_MIN', 'yearMin must be an integer between 1900 and 2100.');
    }
    yearMin = yMin;
  }

  if (b.yearMax !== undefined && b.yearMax !== null && b.yearMax !== '') {
    const yMax = Number(b.yearMax);
    if (!Number.isInteger(yMax) || yMax < 1900 || yMax > 2100) {
      throw new ValidationError('INVALID_YEAR_MAX', 'yearMax must be an integer between 1900 and 2100.');
    }
    yearMax = yMax;
  }

  if (yearMin !== undefined && yearMax !== undefined && yearMin > yearMax) {
    throw new ValidationError(
      'INVALID_YEAR_RANGE',
      'yearMin cannot be greater than yearMax.'
    );
  }

  // Provider validation
  let provider: string | undefined;
  if (b.provider !== undefined && b.provider !== null) {
    if (typeof b.provider !== 'string' || b.provider.length > 50) {
      throw new ValidationError('INVALID_PROVIDER', 'provider must be a string up to 50 characters.');
    }
    const trimmed = b.provider.trim();
    if (trimmed) {
      provider = trimmed;
    }
  }

  let providerFallback: boolean | undefined;
  if (b.providerFallback !== undefined) {
    providerFallback = Boolean(b.providerFallback);
  }

  return {
    sourceType,
    playlistId,
    playlistName,
    mode,
    difficulty,
    guessDuration,
    roundsCount,
    genre,
    artist,
    language,
    yearMin,
    yearMax,
    provider,
    providerFallback
  };
}

export interface ValidatedGuessInput {
  ticketId: string;
  guessText: string;
  reactionTimeMs: number;
  advanceOnWrong: boolean;
  isTimeout: boolean;
}

export function validateGuessInput(body: unknown): ValidatedGuessInput {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('INVALID_REQUEST_BODY', 'Request body must be a valid JSON object.');
  }

  const b = body as Record<string, unknown>;

  const rawTicketId = b.ticketId ?? b.ticket;
  if (!rawTicketId || typeof rawTicketId !== 'string') {
    throw new ValidationError('MISSING_TICKET_ID', 'ticketId is required to submit a guess.');
  }

  const ticketId = validateId(rawTicketId, 'ticketId');

  let guessText = '';
  const rawGuess = b.guessText ?? b.guessedTitle;
  if (rawGuess !== undefined && rawGuess !== null) {
    if (typeof rawGuess !== 'string' || rawGuess.length > 250) {
      throw new ValidationError('INVALID_GUESS_TEXT', 'guessText must be a string up to 250 characters.');
    }
    guessText = rawGuess;
  }

  let reactionTimeMs = 20000;
  if (b.reactionTimeMs !== undefined && b.reactionTimeMs !== null) {
    const rTime = Number(b.reactionTimeMs);
    if (Number.isNaN(rTime) || rTime < 0) {
      throw new ValidationError(
        'INVALID_REACTION_TIME',
        'reactionTimeMs must be a positive number between 0 and 60,000 milliseconds.'
      );
    }
    reactionTimeMs = Math.min(rTime, 60000);
  }

  const advanceOnWrong = Boolean(b.advanceOnWrong);
  const isTimeout = Boolean(b.isTimeout);

  return {
    ticketId,
    guessText,
    reactionTimeMs,
    advanceOnWrong,
    isTimeout
  };
}

export interface ValidatedSkipInput {
  ticketId: string;
}

export function validateSkipInput(body: unknown): ValidatedSkipInput {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('INVALID_REQUEST_BODY', 'Request body must be a valid JSON object.');
  }

  const b = body as Record<string, unknown>;
  const rawTicketId = b.ticketId ?? b.ticket;
  if (!rawTicketId || typeof rawTicketId !== 'string') {
    throw new ValidationError('MISSING_TICKET_ID', 'ticketId is required to skip a stage.');
  }

  return {
    ticketId: validateId(rawTicketId, 'ticketId')
  };
}

export function validatePaginationParams(limitRaw?: string, offsetRaw?: string): { limit: number; offset: number } {
  let limit = 20;
  if (limitRaw !== undefined && limitRaw !== '') {
    const l = Number(limitRaw);
    if (!Number.isInteger(l) || l < 1 || l > 100) {
      throw new ValidationError('INVALID_LIMIT', 'Limit must be an integer between 1 and 100.');
    }
    limit = l;
  }

  let offset = 0;
  if (offsetRaw !== undefined && offsetRaw !== '') {
    const o = Number(offsetRaw);
    if (!Number.isInteger(o) || o < 0 || o > 10000) {
      throw new ValidationError('INVALID_OFFSET', 'Offset must be an integer between 0 and 10,000.');
    }
    offset = o;
  }

  return { limit, offset };
}

