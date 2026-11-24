import crypto from 'crypto';
import { prisma } from '../db/client.js';
import {
  DIFFICULTY_CONFIGS,
  PROGRESSIVE_STAGE_DURATIONS,
  calculateRoundPoints,
  evaluateSongGuess
} from '@songgest/shared';
import type {
  DifficultyLevel,
  GameMode,
  GuessDuration,
  SessionSourceType
} from '@songgest/shared';
import { createGameHistoryRecord } from './historyService.js';
import { musicProviderRegistry } from '../providers/musicProvider.js';

export interface CreateSessionInput {
  sourceType?: SessionSourceType;
  playlistId?: string;
  playlistName?: string;
  mode?: GameMode;
  difficulty?: DifficultyLevel;
  guessDuration?: GuessDuration;
  roundsCount?: number;
  genre?: string;
  artist?: string;
  language?: string;
  yearMin?: number;
  yearMax?: number;
  provider?: string;
  providerFallback?: boolean;
}

export interface SubmitGuessInput {
  sessionId: string;
  ticketId: string;
  guessText: string;
  reactionTimeMs: number;
  advanceOnWrong?: boolean;
  isTimeout?: boolean;
}

export interface SkipRoundInput {
  sessionId: string;
  ticketId: string;
}

export const TICKET_EXPIRATION_WINDOW_SEC = 180; // 180-second validity window for multi-stage progressive round

// Creates a new game session with server-side filtering and round 1 ticket starting at stage 0 (0.1s).
export async function createGameSession(input: CreateSessionInput) {
  const sourceType = input.sourceType ?? 'QUICK_PLAY';
  const mode = input.mode ?? (sourceType === 'SPOTIFY_PLAYLIST' ? 'spotify_playlist' : 'quick_play');
  const difficulty = input.difficulty ?? 'medium';
  const roundsCount = input.roundsCount ?? 5;

  const allowFallback = input.providerFallback !== false;

  const songWhere: Record<string, unknown> = {
    OR: [
      { previewUrl: { not: null } },
      { audioFixturePath: { not: null } }
    ]
  };

  if (sourceType === 'SPOTIFY_PLAYLIST' && input.playlistId) {
    // Only draw songs from the imported Spotify playlist pool
    songWhere.spotifyPlaylistId = input.playlistId;

    // Apply difficulty filter to playlist pool if explicitly requested
    if (input.difficulty && (input.difficulty as string) !== 'all' && DIFFICULTY_CONFIGS[input.difficulty]) {
      const diffConfig = DIFFICULTY_CONFIGS[input.difficulty];
      songWhere.popularityScore = {
        gte: diffConfig.popularityMin,
        lte: diffConfig.popularityMax
      };
    }
  } else {
    // Quick Play mode: determine active or requested provider
    const requestedProviderId = input.provider ?? musicProviderRegistry.getActiveProvider().providerId;
    const diffConfig = DIFFICULTY_CONFIGS[difficulty] ?? DIFFICULTY_CONFIGS.medium;
    const popMin = diffConfig.popularityMin;
    const popMax = diffConfig.popularityMax;

    // Quick Play should use the curated/provider catalog, not ephemeral playlist tracks
    songWhere.spotifyPlaylistId = null;

    if (requestedProviderId === 'deezer') {
      let deezerSongs: any[] = [];
      let deezerError: Error | null = null;

      try {
        const deezerProvider = musicProviderRegistry.getProvider('deezer');
        const searchLimit = Math.max(30, roundsCount * 4);
        deezerSongs = await deezerProvider.searchSongs('', {
          genre: input.genre,
          artist: input.artist,
          language: input.language,
          yearMin: input.yearMin,
          yearMax: input.yearMax,
          difficulty: input.difficulty && (input.difficulty as string) !== 'all' ? input.difficulty : undefined,
          limit: searchLimit
        });
      } catch (err: unknown) {
        deezerError = err instanceof Error ? err : new Error(String(err));
      }

      // If strict difficulty returned fewer than roundsCount playable songs, broaden search
      if (
        !deezerError &&
        deezerSongs.filter((s) => s.previewUrl && typeof s.previewUrl === 'string' && s.previewUrl.startsWith('http')).length < roundsCount &&
        input.difficulty &&
        (input.difficulty as string) !== 'all'
      ) {
        try {
          const searchLimit = Math.max(30, roundsCount * 4);
          const broaderSongs = await deezerProvider.searchSongs('', {
            genre: input.genre,
            artist: input.artist,
            language: input.language,
            yearMin: input.yearMin,
            yearMax: input.yearMax,
            limit: searchLimit
          });
          const validBroader = broaderSongs.filter(
            (s) => s.previewUrl && typeof s.previewUrl === 'string' && s.previewUrl.startsWith('http')
          );
          if (validBroader.length >= roundsCount) {
            deezerSongs = broaderSongs;
          }
        } catch {
          // Fall back to original results
        }
      }

      // Filter Deezer songs to those with valid playable audio preview URLs
      const validDeezerSongs = deezerSongs.filter(
        (s) => s.previewUrl && typeof s.previewUrl === 'string' && s.previewUrl.startsWith('http')
      );

      if (!deezerError && validDeezerSongs.length >= roundsCount) {
        // Persist playable Deezer tracks into SQLite cache for ticket and session integrity
        for (const song of validDeezerSongs) {
          const dbSongId = `deezer_${song.id}`;
          await prisma.song.upsert({
            where: { id: dbSongId },
            update: {
              title: song.title,
              artist: song.artist,
              album: song.album ?? undefined,
              releaseYear: song.releaseYear,
              genre: song.genre,
              subgenres: song.subgenres ? song.subgenres.join(',') : '',
              language: song.language,
              popularityScore: song.popularityScore,
              previewUrl: song.previewUrl,
              previewProvider: 'deezer',
              previewExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
              externalUrl: song.externalUrl ?? undefined,
              albumArtUrl: song.albumArtUrl ?? undefined,
              provider: 'deezer',
              providerSongId: song.id,
              audioFixturePath: null,
              spotifyPlaylistId: null
            },
            create: {
              id: dbSongId,
              title: song.title,
              artist: song.artist,
              album: song.album ?? undefined,
              releaseYear: song.releaseYear,
              genre: song.genre,
              subgenres: song.subgenres ? song.subgenres.join(',') : '',
              language: song.language,
              popularityScore: song.popularityScore,
              previewUrl: song.previewUrl,
              previewProvider: 'deezer',
              previewExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
              externalUrl: song.externalUrl ?? undefined,
              albumArtUrl: song.albumArtUrl ?? undefined,
              provider: 'deezer',
              providerSongId: song.id,
              audioFixturePath: null,
              spotifyPlaylistId: null
            }
          });
        }

        const validIds = validDeezerSongs.map((s) => `deezer_${s.id}`);
        songWhere.id = { in: validIds };
        songWhere.provider = 'deezer';
      } else {
        // Deezer returned insufficient songs or errored out
        if (!allowFallback) {
          if (deezerError) {
            throw deezerError;
          }
          const error = new Error(
            validDeezerSongs.length === 0
              ? 'No songs match your filters on Deezer.'
              : `Found only ${validDeezerSongs.length} playable songs on Deezer matching the selected filters (${roundsCount} required).`
          );
          (error as unknown as { code: string; availableCount: number }).code = 'INSUFFICIENT_SONGS';
          (error as unknown as { availableCount: number }).availableCount = validDeezerSongs.length;
          throw error;
        }

        // Fall back to local fixtures
        console.warn(
          `[QuickPlay] Deezer found ${validDeezerSongs.length} playable songs (${roundsCount} required). Falling back to local fixtures.`
        );
        songWhere.provider = 'local-fixtures';
        songWhere.popularityScore = {
          gte: popMin,
          lte: popMax
        };
      }
    } else {
      // Local fixture provider
      songWhere.provider = 'local-fixtures';
      songWhere.popularityScore = {
        gte: popMin,
        lte: popMax
      };
    }
  }

  if (songWhere.provider !== 'deezer') {
    if (input.genre && input.genre.toLowerCase() !== 'all' && input.genre.toLowerCase() !== 'any') {
      songWhere.genre = input.genre;
    }
    if (input.artist) {
      songWhere.artist = { contains: input.artist };
    }
    if (input.language && input.language.toLowerCase() !== 'all' && input.language.toLowerCase() !== 'any') {
      songWhere.language = input.language;
    }
    if (input.yearMin !== undefined || input.yearMax !== undefined) {
      const yearCond: Record<string, number> = {};
      if (input.yearMin !== undefined) yearCond.gte = input.yearMin;
      if (input.yearMax !== undefined) yearCond.lte = input.yearMax;
      songWhere.releaseYear = yearCond;
    }
  }

  const eligibleSongs = await prisma.song.findMany({ where: songWhere });

  // Guard against zero or insufficient songs matching filter without falling back outside the pool
  if (eligibleSongs.length < roundsCount) {
    const error = new Error(
      eligibleSongs.length === 0
        ? 'No songs match your filters.'
        : `Found only ${eligibleSongs.length} songs matching the selected filters (${roundsCount} required). Please broaden your filters.`
    );
    (error as unknown as { code: string; availableCount: number }).code = 'INSUFFICIENT_SONGS';
    (error as unknown as { availableCount: number }).availableCount = eligibleSongs.length;
    throw error;
  }

  // Shuffle and pick a random song for round 1
  const selectedSong = eligibleSongs[Math.floor(Math.random() * eligibleSongs.length)];

  // Create session with persisted filter criteria and source type
  const session = await prisma.gameSession.create({
    data: {
      sourceType,
      playlistId: input.playlistId ?? undefined,
      playlistName: input.playlistName ?? undefined,
      mode,
      difficulty: input.difficulty ?? 'medium',
      guessDuration: input.guessDuration ?? 0.1,
      genre: input.genre ?? undefined,
      artist: input.artist ?? undefined,
      language: input.language ?? undefined,
      yearMin: input.yearMin ?? undefined,
      yearMax: input.yearMax ?? undefined,
      roundsCount,
      status: 'active',
      totalScore: 0
    }
  });

  // Generate round 1 ticket starting at Stage 0 (0.1s) or supplied initial duration
  const ticketId = `tkt_${crypto.randomBytes(24).toString('hex')}`;
  const expiresAt = new Date(Date.now() + TICKET_EXPIRATION_WINDOW_SEC * 1000);
  const initialDuration = input.guessDuration ?? 0.1;
  const initialStage = input.guessDuration ? Math.max(0, PROGRESSIVE_STAGE_DURATIONS.indexOf(input.guessDuration)) : 0;

  const roundTicket = await prisma.roundTicket.create({
    data: {
      ticketId,
      sessionId: session.id,
      songId: selectedSong.id,
      roundNumber: 1,
      stageIndex: initialStage,
      durationSec: initialDuration,
      expiresAt,
      status: 'issued'
    }
  });


  return {
    session,
    firstRound: {
      roundNumber: roundTicket.roundNumber,
      ticketId: roundTicket.ticketId,
      stageIndex: roundTicket.stageIndex,
      durationSec: roundTicket.durationSec,
      expiresAt: roundTicket.expiresAt.getTime()
    }
  };
}

// Retrieves a game session by ID along with round records.
export async function getGameSession(sessionId: string) {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    include: {
      tickets: {
        orderBy: { roundNumber: 'asc' },
        select: {
          roundNumber: true,
          ticketId: true,
          stageIndex: true,
          durationSec: true,
          status: true,
          pointsAwarded: true,
          createdAt: true
        }
      }
    }
  });

  return session;
}

// Skips to the next progressive clip stage (0.1 -> 0.5 -> 2.0 -> 8.0 -> 15.0).
// If skipping on stage 4 (15.0s), the round is ended as a skip and the answer is revealed.
export async function skipRoundStage(input: SkipRoundInput) {
  const { sessionId, ticketId } = input;

  const ticket = await prisma.roundTicket.findUnique({
    where: { ticketId },
    include: {
      song: true,
      session: {
        include: {
          tickets: {
            where: { status: 'used' },
            orderBy: { roundNumber: 'asc' }
          }
        }
      }
    }
  });

  if (!ticket) {
    const error = new Error('The round ticket does not exist.');
    (error as unknown as { code: string }).code = 'TICKET_NOT_FOUND';
    throw error;
  }

  if (ticket.sessionId !== sessionId) {
    const error = new Error('The round ticket does not belong to this session.');
    (error as unknown as { code: string }).code = 'TICKET_INVALID_FOR_SESSION';
    throw error;
  }

  if (new Date() > ticket.expiresAt) {
    const error = new Error('The round ticket has expired.');
    (error as unknown as { code: string }).code = 'TICKET_EXPIRED';
    throw error;
  }

  if (ticket.status === 'used') {
    const error = new Error('This round ticket has already been used.');
    (error as unknown as { code: string }).code = 'TICKET_ALREADY_USED';
    throw error;
  }

  const currentStageIndex = ticket.stageIndex ?? 0;

  // If there are still clue stages remaining (0 -> 1 -> 2 -> 3 -> 4)
  if (currentStageIndex < PROGRESSIVE_STAGE_DURATIONS.length - 1) {
    const nextStageIndex = currentStageIndex + 1;
    const nextDuration = PROGRESSIVE_STAGE_DURATIONS[nextStageIndex];

    await prisma.roundTicket.update({
      where: { ticketId },
      data: {
        stageIndex: nextStageIndex,
        durationSec: nextDuration
      }
    });

    return {
      roundNumber: ticket.roundNumber,
      stageIndex: nextStageIndex,
      durationSec: nextDuration,
      isRevealed: false
    };
  }

  // Skipping on the final 15s stage: reveal song and end round with 0 points
  const wasMarked = await markTicketUsed(ticket.ticketId, 0);
  if (!wasMarked) {
    const error = new Error('This round ticket has already been used.');
    (error as unknown as { code: string }).code = 'TICKET_ALREADY_USED';
    throw error;
  }

  const isSessionCompleted = ticket.roundNumber >= ticket.session.roundsCount;
  if (isSessionCompleted) {
    await prisma.gameSession.update({
      where: { id: sessionId },
      data: { status: 'completed' }
    });

    await finalizeGameHistory(ticket.session, ticket.session.totalScore);
  }

  return {
    roundNumber: ticket.roundNumber,
    stageIndex: currentStageIndex,
    durationSec: ticket.durationSec,
    isRevealed: true,
    pointsAwarded: 0,
    totalScore: ticket.session.totalScore,
    currentStreak: 0,
    revealedSong: {
      id: ticket.song.id,
      title: ticket.song.title,
      artist: ticket.song.artist,
      album: ticket.song.album ?? undefined,
      releaseYear: ticket.song.releaseYear,
      genre: ticket.song.genre,
      previewUrl: ticket.song.previewUrl ?? (ticket.song.audioFixturePath ? `/api/audio/fixture/${ticket.song.audioFixturePath}` : undefined),
      albumArtUrl: ticket.song.albumArtUrl ?? undefined,
      externalUrl: ticket.song.externalUrl ?? undefined
    },
    isSessionCompleted
  };
}

// Evaluates a player's song guess. Supports progressive advance on wrong guess or final answer evaluation.
export async function submitRoundGuess(input: SubmitGuessInput) {
  const { sessionId, ticketId, guessText, reactionTimeMs, advanceOnWrong = false, isTimeout = false } = input;

  const ticket = await prisma.roundTicket.findUnique({
    where: { ticketId },
    include: {
      song: true,
      session: {
        include: {
          tickets: {
            where: { status: 'used' },
            orderBy: { roundNumber: 'asc' }
          }
        }
      }
    }
  });

  if (!ticket) {
    const error = new Error('The round ticket does not exist.');
    (error as unknown as { code: string }).code = 'TICKET_NOT_FOUND';
    throw error;
  }

  // Cross-session ticket smuggling prevention
  if (ticket.sessionId !== sessionId) {
    const error = new Error('The round ticket does not belong to this session.');
    (error as unknown as { code: string }).code = 'TICKET_INVALID_FOR_SESSION';
    throw error;
  }

  // Ticket expiration check
  if (new Date() > ticket.expiresAt) {
    const error = new Error('The round ticket has expired.');
    (error as unknown as { code: string }).code = 'TICKET_EXPIRED';
    throw error;
  }

  // Already used ticket check
  if (ticket.status === 'used') {
    const error = new Error('This round ticket has already been used.');
    (error as unknown as { code: string }).code = 'TICKET_ALREADY_USED';
    throw error;
  }

  // Bound reaction time on server to prevent client manipulation
  const boundedReactionTimeMs = Math.max(50, Math.min(reactionTimeMs, 35000));

  // Calculate current streak from completed prior rounds
  let currentStreak = 0;
  for (const prev of ticket.session.tickets) {
    if (prev.pointsAwarded > 0) {
      currentStreak += 1;
    } else {
      currentStreak = 0;
    }
  }

  let matchResult = { isCorrect: false, isPartial: false, similarity: 0 };
  let points = 0;

  if (!isTimeout && guessText.trim().length > 0) {
    matchResult = evaluateSongGuess(guessText, ticket.song.title, ticket.song.artist);

    if (matchResult.isCorrect || matchResult.isPartial) {
      points = calculateRoundPoints({
        difficulty: ticket.session.difficulty as DifficultyLevel,
        durationSec: ticket.durationSec as GuessDuration,
        reactionTimeMs: boundedReactionTimeMs,
        currentStreak,
        isPartial: matchResult.isPartial
      });
    }
  }

  // If guess is NOT correct and advanceOnWrong is requested and earlier than final stage:
  // Advance to next progressive clue stage instead of ending the round immediately!
  const currentStageIndex = ticket.stageIndex ?? 0;
  if (!matchResult.isCorrect && !matchResult.isPartial && advanceOnWrong && currentStageIndex < PROGRESSIVE_STAGE_DURATIONS.length - 1 && !isTimeout) {
    const nextStageIndex = currentStageIndex + 1;
    const nextDuration = PROGRESSIVE_STAGE_DURATIONS[nextStageIndex];

    await prisma.roundTicket.update({
      where: { ticketId },
      data: {
        stageIndex: nextStageIndex,
        durationSec: nextDuration
      }
    });

    return {
      roundNumber: ticket.roundNumber,
      stageIndex: nextStageIndex,
      durationSec: nextDuration,
      isCorrect: false,
      isPartial: false,
      isRevealed: false,
      pointsAwarded: 0,
      totalScore: ticket.session.totalScore,
      currentStreak: 0,
      isSessionCompleted: false
    };
  }

  // Complete round: atomic state transition marking ticket as used
  const wasMarked = await markTicketUsed(ticket.ticketId, points);
  if (!wasMarked) {
    const error = new Error('This round ticket has already been used.');
    (error as unknown as { code: string }).code = 'TICKET_ALREADY_USED';
    throw error;
  }

  // Update session total score
  const updatedSession = await prisma.gameSession.update({
    where: { id: sessionId },
    data: {
      totalScore: {
        increment: points
      }
    }
  });

  const newStreak = matchResult.isCorrect || matchResult.isPartial ? currentStreak + 1 : 0;
  const isSessionCompleted = ticket.roundNumber >= ticket.session.roundsCount;

  if (isSessionCompleted) {
    await prisma.gameSession.update({
      where: { id: sessionId },
      data: { status: 'completed' }
    });

    await finalizeGameHistory(ticket.session, updatedSession.totalScore);
  }

  return {
    roundNumber: ticket.roundNumber,
    stageIndex: currentStageIndex,
    durationSec: ticket.durationSec,
    isCorrect: matchResult.isCorrect,
    isPartial: matchResult.isPartial,
    isRevealed: true,
    pointsAwarded: points,
    totalScore: updatedSession.totalScore,
    currentStreak: newStreak,
    revealedSong: {
      id: ticket.song.id,
      title: ticket.song.title,
      artist: ticket.song.artist,
      album: ticket.song.album ?? undefined,
      releaseYear: ticket.song.releaseYear,
      genre: ticket.song.genre,
      previewUrl: ticket.song.previewUrl ?? (ticket.song.audioFixturePath ? `/api/audio/fixture/${ticket.song.audioFixturePath}` : undefined),
      albumArtUrl: ticket.song.albumArtUrl ?? undefined,
      externalUrl: ticket.song.externalUrl ?? undefined
    },
    isSessionCompleted
  };
}

// Issues a subsequent round ticket for an active session respecting active pool filters.
export async function createNextRoundTicket(sessionId: string) {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    include: {
      tickets: {
        orderBy: { roundNumber: 'asc' },
        include: { song: true }
      }
    }
  });

  if (!session) {
    const error = new Error('Session not found.');
    (error as unknown as { code: string }).code = 'SESSION_NOT_FOUND';
    throw error;
  }

  if (session.status !== 'active') {
    const error = new Error('Session is not active.');
    (error as unknown as { code: string }).code = 'SESSION_NOT_ACTIVE';
    throw error;
  }

  const existingRoundsCount = session.tickets.length;
  if (existingRoundsCount >= session.roundsCount) {
    await prisma.gameSession.update({
      where: { id: sessionId },
      data: { status: 'completed' }
    });
    return null;
  }

  const nextRoundNumber = existingRoundsCount + 1;
  const playedSongIds = session.tickets.map((t) => t.songId);

  const songWhere: Record<string, unknown> = {
    id: { notIn: playedSongIds },
    OR: [
      { previewUrl: { not: null } },
      { audioFixturePath: { not: null } }
    ]
  };

  const sessionProvider = session.tickets[0]?.song?.provider;

  if (session.sourceType === 'SPOTIFY_PLAYLIST' && session.playlistId) {
    songWhere.spotifyPlaylistId = session.playlistId;
    if (session.difficulty && session.difficulty !== 'all' && DIFFICULTY_CONFIGS[session.difficulty as DifficultyLevel]) {
      const diffConfig = DIFFICULTY_CONFIGS[session.difficulty as DifficultyLevel];
      songWhere.popularityScore = {
        gte: diffConfig.popularityMin,
        lte: diffConfig.popularityMax
      };
    }
  } else {
    if (sessionProvider) {
      songWhere.provider = sessionProvider;
    }
    if (sessionProvider === 'local-fixtures') {
      const diffConfig = DIFFICULTY_CONFIGS[session.difficulty as DifficultyLevel] ?? DIFFICULTY_CONFIGS.medium;
      songWhere.popularityScore = {
        gte: diffConfig.popularityMin,
        lte: diffConfig.popularityMax
      };
    }
    if (sessionProvider === 'deezer') {
      songWhere.previewUrl = { startsWith: 'http' };
    }
    songWhere.spotifyPlaylistId = null;
  }

  if (sessionProvider !== 'deezer') {
    if (session.genre && session.genre.toLowerCase() !== 'all' && session.genre.toLowerCase() !== 'any') {
      songWhere.genre = session.genre;
    }
    if (session.artist) {
      songWhere.artist = { contains: session.artist };
    }
    if (session.language && session.language.toLowerCase() !== 'all' && session.language.toLowerCase() !== 'any') {
      songWhere.language = session.language;
    }
    if (session.yearMin !== null || session.yearMax !== null) {
      const yearCond: Record<string, number> = {};
      if (session.yearMin !== null) yearCond.gte = session.yearMin;
      if (session.yearMax !== null) yearCond.lte = session.yearMax;
      songWhere.releaseYear = yearCond;
    }
  }

  let candidates = await prisma.song.findMany({ where: songWhere });

  if (candidates.length === 0 && sessionProvider === 'deezer') {
    const deezerProv = musicProviderRegistry.getProvider('deezer');
    if (deezerProv) {
      try {
        const freshSongs = await deezerProv.searchSongs('', {
          genre: session.genre ?? undefined,
          artist: session.artist ?? undefined,
          difficulty: (session.difficulty ?? 'medium') as DifficultyLevel,
          yearMin: session.yearMin ?? undefined,
          yearMax: session.yearMax ?? undefined,
          limit: 30
        });

        for (const s of freshSongs) {
          if (!s.previewUrl || !s.previewUrl.startsWith('http')) continue;
          const dbId = `deezer_${s.id}`;
          if (playedSongIds.includes(dbId)) continue;

          await prisma.song.upsert({
            where: { id: dbId },
            update: {
              previewUrl: s.previewUrl,
              previewExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
            },
            create: {
              id: dbId,
              title: s.title,
              artist: s.artist,
              album: s.album ?? undefined,
              releaseYear: s.releaseYear,
              genre: s.genre,
              subgenres: s.subgenres ? s.subgenres.join(',') : '',
              language: s.language,
              popularityScore: s.popularityScore,
              previewUrl: s.previewUrl,
              previewProvider: 'deezer',
              previewExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
              externalUrl: s.externalUrl ?? undefined,
              albumArtUrl: s.albumArtUrl ?? undefined,
              provider: 'deezer',
              providerSongId: s.id,
              audioFixturePath: null,
              spotifyPlaylistId: null
            }
          });
        }

        candidates = await prisma.song.findMany({
          where: {
            provider: 'deezer',
            previewUrl: { startsWith: 'http' },
            id: { notIn: playedSongIds }
          }
        });
      } catch (err) {
        console.warn('[SessionService] Could not dynamically fetch more Deezer songs:', err);
      }
    }
  }

  if (candidates.length === 0) {
    await prisma.gameSession.update({
      where: { id: sessionId },
      data: { status: 'completed' }
    });
    return null;
  }

  const selectedSong = candidates[Math.floor(Math.random() * candidates.length)];
  const ticketId = `tkt_${crypto.randomBytes(24).toString('hex')}`;
  const expiresAt = new Date(Date.now() + TICKET_EXPIRATION_WINDOW_SEC * 1000);

  try {
    const ticket = await prisma.roundTicket.create({
      data: {
        ticketId,
        sessionId: session.id,
        songId: selectedSong.id,
        roundNumber: nextRoundNumber,
        stageIndex: session.guessDuration ? Math.max(0, PROGRESSIVE_STAGE_DURATIONS.indexOf(session.guessDuration as GuessDuration)) : 0,
        durationSec: session.guessDuration ?? 0.1,
        expiresAt,
        status: 'issued'
      }
    });

    return {
      roundNumber: ticket.roundNumber,
      ticketId: ticket.ticketId,
      stageIndex: ticket.stageIndex,
      durationSec: ticket.durationSec,
      expiresAt: ticket.expiresAt.getTime()
    };
  } catch (err: unknown) {
    const code = (err as unknown as { code?: string })?.code;
    if (code === 'P2002') {
      const concurrentTicket = await prisma.roundTicket.findFirst({
        where: { sessionId, roundNumber: nextRoundNumber }
      });
      if (concurrentTicket) {
        return {
          roundNumber: concurrentTicket.roundNumber,
          ticketId: concurrentTicket.ticketId,
          stageIndex: concurrentTicket.stageIndex,
          durationSec: concurrentTicket.durationSec,
          expiresAt: concurrentTicket.expiresAt.getTime()
        };
      }
    }
    throw err;
  }
}

// Retrieves a ticket record with associated song and session for verification.
export async function getRoundTicketWithDetails(ticketId: string) {
  return prisma.roundTicket.findUnique({
    where: { ticketId },
    include: {
      song: true,
      session: true
    }
  });
}

// Marks a ticket as used, recording points and timestamp atomically.
export async function markTicketUsed(ticketId: string, points = 0) {
  const result = await prisma.roundTicket.updateMany({
    where: {
      ticketId,
      status: 'issued'
    },
    data: {
      status: 'used',
      usedAt: new Date(),
      pointsAwarded: points
    }
  });

  return result.count > 0;
}

// Helper to record history when session concludes
async function finalizeGameHistory(session: { id: string; sourceType: string; playlistName: string | null; mode: string; difficulty: string; guessDuration: number; genre: string | null }, finalScore: number) {
  const allUsedTickets = await prisma.roundTicket.findMany({
    where: { sessionId: session.id, status: 'used' },
    orderBy: { roundNumber: 'asc' }
  });

  const roundsPlayed = allUsedTickets.length;
  const correctAnswers = allUsedTickets.filter((t) => t.pointsAwarded > 0).length;
  const accuracy = roundsPlayed > 0 ? Math.round((correctAnswers / roundsPlayed) * 100) : 0;

  let maxStreak = 0;
  let runStreak = 0;
  for (const t of allUsedTickets) {
    if (t.pointsAwarded > 0) {
      runStreak += 1;
      if (runStreak > maxStreak) maxStreak = runStreak;
    } else {
      runStreak = 0;
    }
  }

  await createGameHistoryRecord({
    sessionId: session.id,
    sourceType: session.sourceType,
    playlistName: session.playlistName,
    mode: session.mode as GameMode,
    difficulty: session.difficulty as DifficultyLevel,
    guessDuration: session.guessDuration as GuessDuration,
    genre: session.genre,
    finalScore,
    roundsPlayed,
    correctAnswers,
    accuracy,
    highestStreak: maxStreak
  });
}
