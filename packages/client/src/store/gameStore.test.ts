import { describe, expect, it } from 'vitest';
import { useGameStore } from './gameStore.js';

describe('Client GameStore State Machine', () => {
  it('initializes with default home configuration and 5 progressive stages ready', () => {
    const state = useGameStore.getState();
    expect(state.currentView).toBe('home');
    expect(state.sourceType).toBe('QUICK_PLAY');
    expect(state.difficulty).toBe('medium');
    expect(state.roundsCount).toBe(5);
    expect(state.currentRoundNumber).toBe(1);
    expect(state.currentStageIndex).toBe(0);
    expect(state.currentStageDuration).toBe(0.1);
    expect(state.totalScore).toBe(0);
    expect(state.currentStreak).toBe(0);
    expect(state.roundResults).toEqual([]);
  });

  it('updates difficulty across all five levels and updates filter settings', () => {
    const store = useGameStore.getState();

    store.setDifficulty('easy');
    expect(useGameStore.getState().difficulty).toBe('easy');

    store.setDifficulty('hard');
    expect(useGameStore.getState().difficulty).toBe('hard');

    store.setDifficulty('expert');
    expect(useGameStore.getState().difficulty).toBe('expert');

    store.setDifficulty('impossible');
    expect(useGameStore.getState().difficulty).toBe('impossible');

    store.setGenre('Rock');
    expect(useGameStore.getState().genre).toBe('Rock');

    store.setEra('2000s');
    expect(useGameStore.getState().era).toBe('2000s');

    store.setArtist('Coldplay');
    expect(useGameStore.getState().artist).toBe('Coldplay');

    store.setRoundsCount(10);
    expect(useGameStore.getState().roundsCount).toBe(10);
  });

  it('updates Spotify playlist URL and manages view navigation', () => {
    const store = useGameStore.getState();

    store.setSpotifyUrl('https://open.spotify.com/playlist/test12345');
    expect(useGameStore.getState().spotifyUrl).toBe('https://open.spotify.com/playlist/test12345');

    store.setCurrentView('quick-play-settings');
    expect(useGameStore.getState().currentView).toBe('quick-play-settings');

    store.setCurrentView('spotify-import');
    expect(useGameStore.getState().currentView).toBe('spotify-import');
  });

  it('resets state cleanly back to home when returnToHome is invoked', () => {
    const store = useGameStore.getState();

    useGameStore.setState({
      currentView: 'final-results',
      totalScore: 7500,
      currentStreak: 4,
      currentRoundNumber: 5,
      currentStageIndex: 2,
      currentStageDuration: 2.0
    });

    store.returnToHome();

    const resetState = useGameStore.getState();
    expect(resetState.currentView).toBe('home');
    expect(resetState.totalScore).toBe(0);
    expect(resetState.currentStreak).toBe(0);
    expect(resetState.currentRoundNumber).toBe(1);
    expect(resetState.currentStageIndex).toBe(0);
    expect(resetState.currentStageDuration).toBe(0.1);
    expect(resetState.roundResults).toEqual([]);
  });
});
