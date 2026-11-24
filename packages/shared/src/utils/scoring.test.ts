import { describe, expect, it } from 'vitest';
import {
  BASE_ROUND_POINTS,
  calculateRoundPoints,
  calculateStreakMultiplier,
  calculateTimeDecay
} from './scoring.js';

describe('Scoring Logic', () => {
  it('calculates higher points for faster reaction times', () => {
    const fastScore = calculateRoundPoints({
      difficulty: 'normal',
      durationSec: 2.0,
      reactionTimeMs: 1500,
      currentStreak: 0
    });

    const slowScore = calculateRoundPoints({
      difficulty: 'normal',
      durationSec: 2.0,
      reactionTimeMs: 16000,
      currentStreak: 0
    });

    expect(fastScore).toBeGreaterThan(slowScore);
  });

  it('rewards shorter audio durations with higher multipliers', () => {
    const ultraShortScore = calculateRoundPoints({
      difficulty: 'normal',
      durationSec: 0.1,
      reactionTimeMs: 2000,
      currentStreak: 0
    });

    const longScore = calculateRoundPoints({
      difficulty: 'normal',
      durationSec: 15.0,
      reactionTimeMs: 2000,
      currentStreak: 0
    });

    expect(ultraShortScore).toBeGreaterThan(longScore * 3);
  });

  it('rewards harder difficulties with higher multipliers', () => {
    const impossibleScore = calculateRoundPoints({
      difficulty: 'impossible',
      durationSec: 0.5,
      reactionTimeMs: 2000,
      currentStreak: 0
    });

    const easyScore = calculateRoundPoints({
      difficulty: 'easy',
      durationSec: 0.5,
      reactionTimeMs: 2000,
      currentStreak: 0
    });

    // Impossible multiplier is 4.5x, Easy is 1.0x (allowing for minor rounding jitter)
    expect(Math.abs(impossibleScore - easyScore * 4.5)).toBeLessThanOrEqual(2);
  });

  it('applies streak multipliers up to the 2.0x ceiling', () => {
    const noStreak = calculateStreakMultiplier(0);
    const midStreak = calculateStreakMultiplier(5);
    const maxStreak = calculateStreakMultiplier(10);
    const overStreak = calculateStreakMultiplier(25);

    expect(noStreak).toBe(1.0);
    expect(midStreak).toBe(1.5);
    expect(maxStreak).toBe(2.0);
    expect(overStreak).toBe(2.0);
  });

  it('awards partial credit for correct artist identification', () => {
    const fullScore = calculateRoundPoints({
      difficulty: 'hard',
      durationSec: 2.0,
      reactionTimeMs: 2000,
      currentStreak: 2,
      isPartial: false
    });

    const partialScore = calculateRoundPoints({
      difficulty: 'hard',
      durationSec: 2.0,
      reactionTimeMs: 2000,
      currentStreak: 2,
      isPartial: true
    });

    expect(partialScore).toBe(Math.round(fullScore * 0.3));
  });

  it('never drops below the minimum time decay floor', () => {
    const decay = calculateTimeDecay(30000); // 30 seconds (exceeding 20s window)
    expect(decay).toBe(0.2);
  });
});
