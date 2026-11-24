import { DIFFICULTY_CONFIGS } from '../constants/difficulties.js';
import { DURATION_CONFIGS } from '../constants/durations.js';
import type { DifficultyLevel, GuessDuration } from '../types/game.js';

export const BASE_ROUND_POINTS = 1000;
export const MAX_REACTION_WINDOW_MS = 20000; // 20-second countdown
export const MIN_TIME_DECAY_FLOOR = 0.2; // Players never get less than 20% of score for late correct answers
export const PARTIAL_CREDIT_RATIO = 0.3; // 30% points for getting the artist correct without the title

export interface ScoreCalculationParams {
  difficulty: DifficultyLevel;
  durationSec: GuessDuration;
  reactionTimeMs: number;
  currentStreak: number;
  isPartial?: boolean;
}

// Calculate the response speed multiplier using a non-linear decay curve.
export function calculateTimeDecay(reactionTimeMs: number, maxWindowMs = MAX_REACTION_WINDOW_MS): number {
  const boundedTime = Math.max(0, Math.min(reactionTimeMs, maxWindowMs));
  const progressRatio = boundedTime / maxWindowMs;
  const decayFactor = 1.0 - Math.pow(progressRatio, 1.5);
  return Math.max(MIN_TIME_DECAY_FLOOR, decayFactor);
}

// Calculate the streak multiplier, capped at 2.0x for 10 consecutive correct answers.
export function calculateStreakMultiplier(streak: number): number {
  const boundedStreak = Math.max(0, streak);
  return 1.0 + Math.min(boundedStreak * 0.1, 1.0);
}

// Calculate final round points based on difficulty, duration, reaction speed, and streak.
export function calculateRoundPoints(params: ScoreCalculationParams): number {
  const { difficulty, durationSec, reactionTimeMs, currentStreak, isPartial = false } = params;

  const diffMultiplier = DIFFICULTY_CONFIGS[difficulty]?.baseMultiplier ?? 1.0;
  const durationKey = durationSec.toFixed(1);
  const durMultiplier = DURATION_CONFIGS[durationKey]?.multiplier ?? 1.0;
  const timeDecay = calculateTimeDecay(reactionTimeMs);
  const streakMultiplier = calculateStreakMultiplier(currentStreak);

  let points = BASE_ROUND_POINTS * diffMultiplier * durMultiplier * timeDecay * streakMultiplier;

  if (isPartial) {
    points *= PARTIAL_CREDIT_RATIO;
  }

  return Math.round(points);
}
