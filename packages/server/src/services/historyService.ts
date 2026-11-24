import { prisma } from '../db/client.js';
import type { DifficultyLevel, GameHistoryRecord, GameMode, GuessDuration, PlayerHistoryStats } from '@songgest/shared';

export interface CreateHistoryRecordInput {
  sessionId: string;
  sourceType?: string;
  playlistName?: string | null;
  mode?: GameMode;
  difficulty: DifficultyLevel;
  guessDuration?: GuessDuration;
  genre?: string | null;
  finalScore: number;
  roundsPlayed: number;
  correctAnswers: number;
  accuracy: number;
  highestStreak: number;
}

// Persists a completed game session into the history ledger.
export async function createGameHistoryRecord(input: CreateHistoryRecordInput) {
  return prisma.gameHistory.create({
    data: {
      sessionId: input.sessionId,
      sourceType: input.sourceType ?? 'QUICK_PLAY',
      playlistName: input.playlistName ?? undefined,
      mode: input.mode ?? 'quick_play',
      difficulty: input.difficulty,
      guessDuration: input.guessDuration ?? 0.1,
      genre: input.genre ?? undefined,
      finalScore: input.finalScore,
      roundsPlayed: input.roundsPlayed,
      correctAnswers: input.correctAnswers,
      accuracy: input.accuracy,
      highestStreak: input.highestStreak
    }
  });
}

// Computes aggregate player statistics and retrieves recent game sessions.
export async function getPlayerHistoryStats(limit = 10): Promise<PlayerHistoryStats> {
  const records = await prisma.gameHistory.findMany({
    orderBy: { completedAt: 'desc' },
    take: limit
  });

  const totalCount = await prisma.gameHistory.count();

  if (totalCount === 0) {
    return {
      gamesPlayed: 0,
      highestScore: 0,
      averageScore: 0,
      overallAccuracy: 0,
      highestStreak: 0,
      recentGames: []
    };
  }

  const allRecords = await prisma.gameHistory.findMany({
    select: {
      finalScore: true,
      correctAnswers: true,
      roundsPlayed: true,
      highestStreak: true
    }
  });

  let sumScore = 0;
  let maxScore = 0;
  let totalCorrect = 0;
  let totalRounds = 0;
  let maxStreak = 0;

  for (const r of allRecords) {
    sumScore += r.finalScore;
    if (r.finalScore > maxScore) maxScore = r.finalScore;
    totalCorrect += r.correctAnswers;
    totalRounds += r.roundsPlayed;
    if (r.highestStreak > maxStreak) maxStreak = r.highestStreak;
  }

  const averageScore = Math.round(sumScore / allRecords.length);
  const overallAccuracy = totalRounds > 0 ? Math.round((totalCorrect / totalRounds) * 100) : 0;

  const recentGames: GameHistoryRecord[] = records.map((rec) => ({
    id: rec.id,
    sessionId: rec.sessionId,
    sourceType: (rec.sourceType as any) || 'QUICK_PLAY',
    playlistName: rec.playlistName,
    mode: rec.mode as GameMode,
    difficulty: rec.difficulty as DifficultyLevel,
    guessDuration: rec.guessDuration as GuessDuration,
    genre: rec.genre,
    finalScore: rec.finalScore,
    roundsPlayed: rec.roundsPlayed,
    correctAnswers: rec.correctAnswers,
    accuracy: rec.accuracy,
    highestStreak: rec.highestStreak,
    completedAt: rec.completedAt.toISOString()
  }));

  return {
    gamesPlayed: totalCount,
    highestScore: maxScore,
    averageScore,
    overallAccuracy,
    highestStreak: maxStreak,
    recentGames
  };
}

