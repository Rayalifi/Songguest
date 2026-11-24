import { describe, expect, it } from 'vitest';
import {
  calculateStringSimilarity,
  computeLevenshteinDistance,
  evaluateSongGuess,
  normalizeSongString
} from './fuzzyMatch.js';

describe('Fuzzy Matching Utilities', () => {
  it('normalizes strings by stripping accents, brackets, and secondary tags', () => {
    expect(normalizeSongString('Bohemian Rhapsody (Remastered 2011)')).toBe('bohemian rhapsody');
    expect(normalizeSongString('Daft Punk feat. Pharrell Williams [Radio Edit]')).toBe('daft punk');
    expect(normalizeSongString('Héllö, Wörld!')).toBe('hello world');
  });

  it('computes accurate Levenshtein distance', () => {
    expect(computeLevenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(computeLevenshteinDistance('queen', 'queen')).toBe(0);
    expect(computeLevenshteinDistance('fleetwood', 'fleetwod')).toBe(1);
  });

  it('matches exact title strings', () => {
    const res = evaluateSongGuess('Bohemian Rhapsody', 'Bohemian Rhapsody', 'Queen');
    expect(res.isCorrect).toBe(true);
    expect(res.isPartial).toBe(false);
  });

  it('tolerates minor typos in the song title', () => {
    const res = evaluateSongGuess('Bohemain Rapsody', 'Bohemian Rhapsody', 'Queen');
    expect(res.isCorrect).toBe(true);
  });

  it('matches combined artist and title inputs', () => {
    const forward = evaluateSongGuess('Queen Bohemian Rhapsody', 'Bohemian Rhapsody', 'Queen');
    expect(forward.isCorrect).toBe(true);

    const reverse = evaluateSongGuess('Bohemian Rhapsody Queen', 'Bohemian Rhapsody', 'Queen');
    expect(reverse.isCorrect).toBe(true);
  });

  it('awards partial credit when only the artist name is correct', () => {
    const res = evaluateSongGuess('Queen', 'Bohemian Rhapsody', 'Queen');
    expect(res.isCorrect).toBe(false);
    expect(res.isPartial).toBe(true);
  });

  it('rejects incorrect guesses completely', () => {
    const res = evaluateSongGuess('Toxic', 'Bohemian Rhapsody', 'Queen');
    expect(res.isCorrect).toBe(false);
    expect(res.isPartial).toBe(false);
  });
});
