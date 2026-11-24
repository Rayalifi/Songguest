import type { GuessDuration, ProgressiveStage } from '../types/game.js';

export interface DurationConfig {
  durationSec: GuessDuration;
  label: string;
  multiplier: number;
  subtitle: string;
}

export const PROGRESSIVE_STAGES: ProgressiveStage[] = [
  {
    stageIndex: 0,
    durationSec: 0.1,
    label: '0.1s',
    multiplier: 5.0,
    description: 'Instant attack'
  },
  {
    stageIndex: 1,
    durationSec: 0.5,
    label: '0.5s',
    multiplier: 3.0,
    description: 'Rhythm groove'
  },
  {
    stageIndex: 2,
    durationSec: 2.0,
    label: '2.0s',
    multiplier: 1.8,
    description: 'Melodic hook'
  },
  {
    stageIndex: 3,
    durationSec: 8.0,
    label: '8.0s',
    multiplier: 1.2,
    description: 'Full phrase'
  },
  {
    stageIndex: 4,
    durationSec: 15.0,
    label: '15.0s',
    multiplier: 0.8,
    description: 'Extended passage'
  }
];

export const PROGRESSIVE_STAGE_DURATIONS: GuessDuration[] = [0.1, 0.5, 2.0, 8.0, 15.0];
export const GUESS_DURATIONS: GuessDuration[] = [0.1, 0.5, 2.0, 8.0, 15.0];

export const DURATION_CONFIGS: Record<string, DurationConfig> = {
  '0.1': {
    durationSec: 0.1,
    label: '0.1s',
    multiplier: 5.0,
    subtitle: 'Instant attack'
  },
  '0.5': {
    durationSec: 0.5,
    label: '0.5s',
    multiplier: 3.0,
    subtitle: 'Rhythm groove'
  },
  '2.0': {
    durationSec: 2.0,
    label: '2.0s',
    multiplier: 1.8,
    subtitle: 'Melodic hook'
  },
  '8.0': {
    durationSec: 8.0,
    label: '8.0s',
    multiplier: 1.2,
    subtitle: 'Full phrase'
  },
  '15.0': {
    durationSec: 15.0,
    label: '15.0s',
    multiplier: 0.8,
    subtitle: 'Extended passage'
  }
};

export function getProgressiveStage(stageIndex: number): ProgressiveStage {
  const boundedIndex = Math.max(0, Math.min(stageIndex, PROGRESSIVE_STAGES.length - 1));
  return PROGRESSIVE_STAGES[boundedIndex];
}

