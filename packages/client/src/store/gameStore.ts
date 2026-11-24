import { create } from 'zustand';
import type {
  DifficultyLevel,
  FilterOptionsPayload,
  GameHistoryRecord,
  GuessDuration,
  PlayerHistoryStats,
  ProgressiveStage,
  SessionSourceType,
  SongAutocompleteItem,
  SpotifyPlaylistMetadata
} from '@songgest/shared';
import {
  PROGRESSIVE_STAGES,
  PROGRESSIVE_STAGE_DURATIONS,
  getProgressiveStage
} from '@songgest/shared';
import { audioEngine } from '../services/audioEngine.js';

export type AppView =
  | 'home'
  | 'quick-play-settings'
  | 'spotify-import'
  | 'game'
  | 'round-result'
  | 'final-results'
  | 'history';

export interface RevealedSongInfo {
  id: string;
  title: string;
  artist: string;
  album?: string;
  releaseYear: number;
  genre: string;
  previewUrl?: string;
  albumArtUrl?: string;
  externalUrl?: string;
}

export interface RoundResultData {
  roundNumber: number;
  stageIndex: number;
  isCorrect: boolean;
  isPartial: boolean;
  pointsAwarded: number;
  revealedSong: RevealedSongInfo;
  reactionTimeMs: number;
}

export interface GameStoreState {
  // Navigation & Screen View
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
  statusMessage: string | null;
  errorMessage: string | null;
  isLoading: boolean;
  isAudioPlaying: boolean;

  // Game Source & Setup
  sourceType: SessionSourceType;
  difficulty: DifficultyLevel;
  genre: string;
  era: string; // 'all' | '1970s' | '1980s' | '1990s' | '2000s' | '2010s' | '2020s'
  artist: string;
  roundsCount: number;

  // Filter setters
  setDifficulty: (diff: DifficultyLevel) => void;
  setGenre: (genre: string) => void;
  setEra: (era: string) => void;
  setArtist: (artist: string) => void;
  setRoundsCount: (count: number) => void;

  // Available catalog filters
  availableFilters: FilterOptionsPayload | null;
  fetchFilterOptions: () => Promise<void>;

  // Spotify Playlist Import & Auth
  spotifyUrl: string;
  setSpotifyUrl: (url: string) => void;
  importedPlaylist: SpotifyPlaylistMetadata | null;
  importLoading: boolean;
  importError: string | null;
  requiresSpotifyAuth: boolean;
  isSpotifyConnected: boolean;
  spotifyUser: { id?: string; displayName?: string } | null;
  spotifySessionToken: string | null;
  checkSpotifyAuth: () => Promise<void>;
  connectSpotify: () => Promise<void>;
  disconnectSpotify: () => Promise<void>;
  importSpotifyPlaylist: (url: string) => Promise<boolean>;

  // Active Session & Progressive Game
  sessionId: string | null;
  currentRoundNumber: number;
  currentTicketId: string | null;
  currentStageIndex: number;
  currentStageDuration: GuessDuration;
  roundStartedAt: number | null;

  // Score & Metrics
  totalScore: number;
  currentStreak: number;
  roundResults: RoundResultData[];
  lastResult: {
    isCorrect: boolean;
    isPartial: boolean;
    pointsAwarded: number;
    revealedSong?: RevealedSongInfo;
  } | null;
  guessFeedback: string | null;

  // Autocomplete
  autocompleteResults: SongAutocompleteItem[];
  searchAutocomplete: (query: string) => Promise<void>;
  clearAutocomplete: () => void;

  // History
  historyStats: PlayerHistoryStats | null;
  historyLoading: boolean;
  fetchHistory: () => Promise<void>;

  // Game Actions
  startQuickPlaySession: () => Promise<void>;
  startSpotifySession: () => Promise<void>;
  playCurrentClip: () => Promise<void>;
  skipCurrentStage: () => Promise<void>;
  submitGuess: (guessText: string) => Promise<void>;
  advanceToNextSong: () => Promise<void>;
  returnToHome: () => void;
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  currentView: 'home',
  setCurrentView: (view) => {
    audioEngine.stop();
    set({ currentView: view, errorMessage: null, guessFeedback: null });
    if (view === 'history') {
      get().fetchHistory();
    }
  },
  statusMessage: null,
  errorMessage: null,
  isLoading: false,
  isAudioPlaying: false,

  sourceType: 'QUICK_PLAY',
  difficulty: 'medium',
  genre: 'all',
  era: 'all',
  artist: '',
  roundsCount: 5,

  setDifficulty: (difficulty) => set({ difficulty }),
  setGenre: (genre) => set({ genre }),
  setEra: (era) => set({ era }),
  setArtist: (artist) => set({ artist }),
  setRoundsCount: (roundsCount) => set({ roundsCount }),

  availableFilters: null,
  fetchFilterOptions: async () => {
    try {
      const res = await fetch('/api/songs/filters');
      if (res.ok) {
        const data = await res.json();
        set({ availableFilters: data });
      }
    } catch {
      // Non-blocking
    }
  },

  spotifyUrl: '',
  setSpotifyUrl: (spotifyUrl) => set({ spotifyUrl, importError: null, requiresSpotifyAuth: false }),
  importedPlaylist: null,
  importLoading: false,
  importError: null,
  requiresSpotifyAuth: false,
  isSpotifyConnected: false,
  spotifyUser: null,
  spotifySessionToken: typeof window !== 'undefined' ? localStorage.getItem('songgest_spotify_token') : null,

  checkSpotifyAuth: async () => {
    // Check URL parameters for session token returned from OAuth callback
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const tokenFromUrl = urlParams.get('session_token');
      if (tokenFromUrl) {
        localStorage.setItem('songgest_spotify_token', tokenFromUrl);
        set({ spotifySessionToken: tokenFromUrl });
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }

    const token = get().spotifySessionToken;
    if (!token) {
      set({ isSpotifyConnected: false, spotifyUser: null });
      return;
    }

    try {
      const res = await fetch('/api/spotify/status', {
        headers: { 'x-spotify-session': token }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.isConnected) {
          set({
            isSpotifyConnected: true,
            spotifyUser: { id: data.spotifyUserId, displayName: data.displayName }
          });
          return;
        }
      }
      set({ isSpotifyConnected: false, spotifyUser: null });
    } catch {
      set({ isSpotifyConnected: false, spotifyUser: null });
    }
  },

  connectSpotify: async () => {
    try {
      const res = await fetch('/api/spotify/auth-url');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        set({ importError: data.message || 'Spotify integration is not configured with credentials.' });
        return;
      }
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch {
      set({ importError: 'Failed to initiate Spotify connection.' });
    }
  },

  disconnectSpotify: async () => {
    const token = get().spotifySessionToken;
    if (token) {
      await fetch('/api/spotify/disconnect', {
        method: 'POST',
        headers: { 'x-spotify-session': token }
      }).catch(() => {});
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem('songgest_spotify_token');
    }
    set({
      spotifySessionToken: null,
      isSpotifyConnected: false,
      spotifyUser: null,
      requiresSpotifyAuth: false
    });
  },

  importSpotifyPlaylist: async (url: string) => {
    set({ importLoading: true, importError: null, requiresSpotifyAuth: false });
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = get().spotifySessionToken;
      if (token) {
        headers['x-spotify-session'] = token;
      }

      const res = await fetch('/api/spotify/playlists/import', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url })
      });

      const data = await res.json();
      if (!res.ok) {
        const requiresAuth = res.status === 401 || data.error === 'SPOTIFY_AUTH_REQUIRED';
        set({
          importLoading: false,
          requiresSpotifyAuth: requiresAuth,
          importError: data.message || 'Failed to import Spotify playlist.'
        });
        return false;
      }

      const playlistData = data.playlist || data;
      set({
        importLoading: false,
        importedPlaylist: playlistData,
        sourceType: 'SPOTIFY_PLAYLIST'
      });
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error importing playlist.';
      set({ importLoading: false, importError: msg });
      return false;
    }
  },

  sessionId: null,
  currentRoundNumber: 1,
  currentTicketId: null,
  currentStageIndex: 0,
  currentStageDuration: 0.1,
  roundStartedAt: null,

  totalScore: 0,
  currentStreak: 0,
  roundResults: [],
  lastResult: null,
  guessFeedback: null,

  autocompleteResults: [],
  searchAutocomplete: async (query: string) => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      set({ autocompleteResults: [] });
      return;
    }
    try {
      const res = await fetch(`/api/songs/search?q=${encodeURIComponent(trimmed)}&limit=8`);
      if (res.ok) {
        const data = await res.json();
        set({ autocompleteResults: data.results || [] });
      }
    } catch {
      // Non-blocking
    }
  },
  clearAutocomplete: () => set({ autocompleteResults: [] }),

  historyStats: null,
  historyLoading: false,
  fetchHistory: async () => {
    set({ historyLoading: true });
    try {
      const res = await fetch('/api/history?limit=10');
      if (res.ok) {
        const data: PlayerHistoryStats = await res.json();
        set({ historyStats: data, historyLoading: false });
      } else {
        set({ historyLoading: false });
      }
    } catch {
      set({ historyLoading: false });
    }
  },

  startQuickPlaySession: async () => {
    audioEngine.reset();
    set({
      isLoading: true,
      errorMessage: null,
      sourceType: 'QUICK_PLAY',
      totalScore: 0,
      currentStreak: 0,
      roundResults: [],
      currentRoundNumber: 1,
      currentStageIndex: 0,
      currentStageDuration: 0.1,
      roundStartedAt: null,
      guessFeedback: null,
      lastResult: null
    });

    // Parse Era into yearMin / yearMax bounds
    let yearMin: number | undefined;
    let yearMax: number | undefined;
    const era = get().era;
    if (era === '1970s') { yearMin = 1970; yearMax = 1979; }
    else if (era === '1980s') { yearMin = 1980; yearMax = 1989; }
    else if (era === '1990s') { yearMin = 1990; yearMax = 1999; }
    else if (era === '2000s') { yearMin = 2000; yearMax = 2009; }
    else if (era === '2010s') { yearMin = 2010; yearMax = 2019; }
    else if (era === '2020s') { yearMin = 2020; yearMax = 2029; }

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: 'QUICK_PLAY',
          provider: 'deezer',
          difficulty: get().difficulty,
          roundsCount: get().roundsCount,
          genre: get().genre !== 'all' ? get().genre : undefined,
          artist: get().artist.trim() || undefined,
          yearMin,
          yearMax
        })
      });

      const data = await res.json();

      if (!res.ok) {
        set({
          isLoading: false,
          errorMessage: data.message || 'Could not start game session.'
        });
        return;
      }

      set({
        sessionId: data.session.id,
        currentRoundNumber: data.firstRound.roundNumber,
        currentTicketId: data.firstRound.ticketId,
        currentStageIndex: data.firstRound.stageIndex ?? 0,
        currentStageDuration: data.firstRound.durationSec ?? 0.1,
        currentView: 'game',
        isLoading: false,
        roundStartedAt: Date.now()
      });

      try {
        await audioEngine.loadTicketAudio(data.firstRound.ticketId);
      } catch {
        // Non-fatal background preload: playCurrentClip will load on demand when user taps play
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error starting game.';
      set({ isLoading: false, errorMessage: msg });
    }
  },

  startSpotifySession: async () => {
    const playlist = get().importedPlaylist;
    if (!playlist) return;

    audioEngine.reset();
    set({
      isLoading: true,
      errorMessage: null,
      sourceType: 'SPOTIFY_PLAYLIST',
      totalScore: 0,
      currentStreak: 0,
      roundResults: [],
      currentRoundNumber: 1,
      currentStageIndex: 0,
      currentStageDuration: 0.1,
      roundStartedAt: null,
      guessFeedback: null,
      lastResult: null
    });

    let yearMin: number | undefined;
    let yearMax: number | undefined;
    const era = get().era;
    if (era === '1970s') { yearMin = 1970; yearMax = 1979; }
    else if (era === '1980s') { yearMin = 1980; yearMax = 1989; }
    else if (era === '1990s') { yearMin = 1990; yearMax = 1999; }
    else if (era === '2000s') { yearMin = 2000; yearMax = 2009; }
    else if (era === '2010s') { yearMin = 2010; yearMax = 2019; }
    else if (era === '2020s') { yearMin = 2020; yearMax = 2029; }

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: 'SPOTIFY_PLAYLIST',
          playlistId: playlist.id,
          playlistName: playlist.name,
          difficulty: get().difficulty,
          roundsCount: Math.min(get().roundsCount, playlist.playableCount),
          genre: get().genre !== 'all' ? get().genre : undefined,
          artist: get().artist.trim() || undefined,
          yearMin,
          yearMax
        })
      });

      const data = await res.json();

      if (!res.ok) {
        set({
          isLoading: false,
          errorMessage: data.message || 'Not enough songs match your filters in this playlist.'
        });
        return;
      }

      set({
        sessionId: data.session.id,
        currentRoundNumber: data.firstRound.roundNumber,
        currentTicketId: data.firstRound.ticketId,
        currentStageIndex: data.firstRound.stageIndex ?? 0,
        currentStageDuration: data.firstRound.durationSec ?? 0.1,
        currentView: 'game',
        isLoading: false,
        roundStartedAt: Date.now()
      });

      try {
        await audioEngine.loadTicketAudio(data.firstRound.ticketId);
      } catch {
        set({ statusMessage: 'Audio loading... tap Play to listen.' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error starting playlist game.';
      set({ isLoading: false, errorMessage: msg });
    }
  },

  playCurrentClip: async () => {
    const { currentStageDuration, currentTicketId } = get();
    if (!currentTicketId) return;

    set({ isAudioPlaying: true, statusMessage: null });
    try {
      if (!audioEngine.hasLoadedTicket(currentTicketId)) {
        await audioEngine.loadTicketAudio(currentTicketId);
      }
      await audioEngine.play(currentStageDuration);
      set({ isAudioPlaying: false });
    } catch (err: unknown) {
      // If playback was naturally stopped by timer pause, ignore gracefully
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('pause') || err.message.includes('interrupted'))) {
        set({ isAudioPlaying: false });
        return;
      }

      const isAutoplayBlocked = err instanceof Error && (
        err.name === 'NotAllowedError' ||
        err.message.includes('user gesture') ||
        err.message.includes('interact')
      );

      set({
        isAudioPlaying: false,
        statusMessage: isAutoplayBlocked
          ? 'Tap Play to listen (browser audio policy).'
          : 'Could not play audio snippet. Tap Play to retry.'
      });
    }
  },

  skipCurrentStage: async () => {
    audioEngine.stop();
    const { sessionId, currentTicketId } = get();
    if (!sessionId || !currentTicketId) return;

    set({ isLoading: true, guessFeedback: null });

    try {
      const res = await fetch(`/api/sessions/${sessionId}/skip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: currentTicketId })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error skipping stage');
      }

      if (!data.isRevealed) {
        // Clue stage advanced (e.g. 0.1s -> 0.5s)
        set({
          isLoading: false,
          currentStageIndex: data.stageIndex,
          currentStageDuration: data.durationSec,
          guessFeedback: `Clue revealed: ${data.durationSec}s`
        });
      } else {
        // Final stage skipped: round ended as incorrect/skipped
        const resultItem: RoundResultData = {
          roundNumber: data.roundNumber,
          stageIndex: data.stageIndex,
          isCorrect: false,
          isPartial: false,
          pointsAwarded: 0,
          revealedSong: data.revealedSong,
          reactionTimeMs: get().roundStartedAt
            ? Math.max(0, Math.min(Date.now() - get().roundStartedAt!, 60000))
            : 0
        };

        set({
          isLoading: false,
          currentView: 'round-result',
          currentStreak: 0,
          lastResult: {
            isCorrect: false,
            isPartial: false,
            pointsAwarded: 0,
            revealedSong: data.revealedSong
          },
          roundResults: [...get().roundResults, resultItem]
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error processing skip.';
      set({ isLoading: false, errorMessage: msg });
    }
  },

  submitGuess: async (guessText: string) => {
    audioEngine.stop();
    const { sessionId, currentTicketId, roundStartedAt } = get();
    if (!sessionId || !currentTicketId || !guessText.trim()) return;

    set({ isLoading: true, guessFeedback: null });
    const reactionTimeMs = roundStartedAt
      ? Math.max(50, Math.min(Date.now() - roundStartedAt, 60000))
      : 5000;

    try {
      const res = await fetch(`/api/sessions/${sessionId}/guess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: currentTicketId,
          guessText: guessText.trim(),
          reactionTimeMs,
          advanceOnWrong: true // Reveal next progressive clue on incorrect answer
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error submitting guess');
      }

      if (data.isCorrect || data.isPartial) {
        // Correct or Partial guess: immediate win for this round!
        const resultItem: RoundResultData = {
          roundNumber: data.roundNumber,
          stageIndex: data.stageIndex ?? get().currentStageIndex,
          isCorrect: data.isCorrect,
          isPartial: data.isPartial,
          pointsAwarded: data.pointsAwarded,
          revealedSong: data.revealedSong,
          reactionTimeMs
        };

        set({
          isLoading: false,
          currentView: 'round-result',
          totalScore: data.totalScore,
          currentStreak: data.currentStreak,
          lastResult: {
            isCorrect: data.isCorrect,
            isPartial: data.isPartial,
            pointsAwarded: data.pointsAwarded,
            revealedSong: data.revealedSong
          },
          roundResults: [...get().roundResults, resultItem]
        });
      } else if (!data.isRevealed) {
        // Incorrect guess on early stage: advance to next progressive clue stage!
        set({
          isLoading: false,
          currentStageIndex: data.stageIndex,
          currentStageDuration: data.durationSec,
          guessFeedback: `Incorrect! More audio revealed: ${data.durationSec}s`
        });
      } else {
        // Incorrect guess on final stage (15s): round ends as incorrect
        const resultItem: RoundResultData = {
          roundNumber: data.roundNumber,
          stageIndex: data.stageIndex ?? 4,
          isCorrect: false,
          isPartial: false,
          pointsAwarded: 0,
          revealedSong: data.revealedSong,
          reactionTimeMs
        };

        set({
          isLoading: false,
          currentView: 'round-result',
          currentStreak: 0,
          lastResult: {
            isCorrect: false,
            isPartial: false,
            pointsAwarded: 0,
            revealedSong: data.revealedSong
          },
          roundResults: [...get().roundResults, resultItem]
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error submitting guess.';
      set({ isLoading: false, errorMessage: msg });
    }
  },

  advanceToNextSong: async () => {
    audioEngine.reset();
    const { sessionId, roundResults, roundsCount } = get();

    if (roundResults.length >= roundsCount) {
      set({ currentView: 'final-results' });
      return;
    }

    set({ isLoading: true, errorMessage: null });

    try {
      const res = await fetch(`/api/sessions/${sessionId}/rounds/next`, {
        method: 'POST'
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error advancing to next song');
      }

      if (data.isCompleted || !data.nextRound) {
        set({ currentView: 'final-results', isLoading: false });
        return;
      }

      const nextRound = data.nextRound;
      set({
        currentRoundNumber: nextRound.roundNumber,
        currentTicketId: nextRound.ticketId,
        currentStageIndex: nextRound.stageIndex ?? 0,
        currentStageDuration: nextRound.durationSec ?? 0.1,
        currentView: 'game',
        isLoading: false,
        guessFeedback: null,
        roundStartedAt: Date.now()
      });

      try {
        await audioEngine.loadTicketAudio(nextRound.ticketId);
      } catch {
        // Non-fatal background preload: playCurrentClip will load on demand when user taps play
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error fetching next song.';
      set({ isLoading: false, errorMessage: msg });
    }
  },

  returnToHome: () => {
    audioEngine.reset();
    set({
      currentView: 'home',
      sessionId: null,
      currentRoundNumber: 1,
      currentTicketId: null,
      currentStageIndex: 0,
      currentStageDuration: 0.1,
      totalScore: 0,
      currentStreak: 0,
      roundResults: [],
      lastResult: null,
      guessFeedback: null,
      errorMessage: null,
      statusMessage: null
    });
  }
}));
