import type { DifficultyLevel } from '../types/game.js';

export interface DifficultyConfig {
  id: DifficultyLevel;
  label: string;
  popularityMin: number;
  popularityMax: number;
  baseMultiplier: number;
  description: string;
}

export const DIFFICULTY_CONFIGS: Record<DifficultyLevel, DifficultyConfig> = {
  easy: {
    id: 'easy',
    label: 'Easy',
    popularityMin: 80,
    popularityMax: 100,
    baseMultiplier: 1.0,
    description: 'Popular and widely recognizable signature tracks.'
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    popularityMin: 60,
    popularityMax: 79,
    baseMultiplier: 1.5,
    description: 'Moderately popular songs and celebrated favorites.'
  },
  normal: {
    id: 'normal',
    label: 'Medium',
    popularityMin: 60,
    popularityMax: 79,
    baseMultiplier: 1.5,
    description: 'Moderately popular songs and celebrated favorites.'
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    popularityMin: 40,
    popularityMax: 59,
    baseMultiplier: 2.2,
    description: 'Less obvious tracks, deep cuts, and subgenre favorites.'
  },
  expert: {
    id: 'expert',
    label: 'Expert',
    popularityMin: 20,
    popularityMax: 39,
    baseMultiplier: 3.2,
    description: 'Niche songs and discerning enthusiast selections.'
  },
  impossible: {
    id: 'impossible',
    label: 'Impossible',
    popularityMin: 0,
    popularityMax: 19,
    baseMultiplier: 4.5,
    description: 'Highly difficult, obscure gems, and rare underground cuts.'
  }
};

export const DIFFICULTY_LEVELS: DifficultyLevel[] = ['easy', 'medium', 'hard', 'expert', 'impossible', 'normal'];

// Derives the difficulty tier directly from a song's popularity score heuristic.
export function getDifficultyFromPopularity(popularityScore: number): DifficultyLevel {
  const boundedScore = Math.max(0, Math.min(100, Math.round(popularityScore)));
  if (boundedScore >= 80) return 'easy';
  if (boundedScore >= 60) return 'medium';
  if (boundedScore >= 40) return 'hard';
  if (boundedScore >= 20) return 'expert';
  return 'impossible';
}

