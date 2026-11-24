import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DIFFICULTY_CONFIGS,
  PROGRESSIVE_STAGES,
  type DifficultyLevel,
  type SongAutocompleteItem
} from '@songgest/shared';
import { useGameStore } from './store/gameStore.js';

const AVAILABLE_DIFFICULTIES: DifficultyLevel[] = ['easy', 'medium', 'hard', 'expert', 'impossible'];
const ERA_OPTIONS = ['all', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
const ROUNDS_OPTIONS = [5, 10, 20];

export default function App(): React.ReactElement {
  const store = useGameStore();

  // Local state for guess input & autocomplete
  const [guessInput, setGuessInput] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [selectedAutocompleteIndex, setSelectedAutocompleteIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Local state for revealed song audio preview playback in round result view
  const [isRevealedAudioPlaying, setIsRevealedAudioPlaying] = useState(false);
  const revealedAudioRef = useRef<HTMLAudioElement | null>(null);

  // Stop revealed audio when leaving round-result view
  useEffect(() => {
    if (store.currentView !== 'round-result') {
      if (revealedAudioRef.current) {
        revealedAudioRef.current.pause();
        revealedAudioRef.current.currentTime = 0;
      }
      setIsRevealedAudioPlaying(false);
    }
  }, [store.currentView]);

  const toggleRevealedAudio = () => {
    if (!revealedAudioRef.current) return;
    if (isRevealedAudioPlaying) {
      revealedAudioRef.current.pause();
      setIsRevealedAudioPlaying(false);
    } else {
      revealedAudioRef.current.play().then(() => {
        setIsRevealedAudioPlaying(true);
      }).catch(() => {
        setIsRevealedAudioPlaying(false);
      });
    }
  };

  const handleAdvanceToNextSong = () => {
    if (revealedAudioRef.current) {
      revealedAudioRef.current.pause();
      revealedAudioRef.current.currentTime = 0;
    }
    setIsRevealedAudioPlaying(false);
    store.advanceToNextSong();
  };

  // Fetch filter options and check Spotify auth status on mount
  useEffect(() => {
    store.fetchFilterOptions();
    store.checkSpotifyAuth();
  }, []);

  // Focus input when entering game view or advancing stage
  useEffect(() => {
    if (store.currentView === 'game') {
      inputRef.current?.focus();
    }
  }, [store.currentView, store.currentStageIndex, store.currentRoundNumber]);

  // Debounced autocomplete search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (guessInput.trim().length >= 2 && store.currentView === 'game') {
        store.searchAutocomplete(guessInput.trim());
        setShowAutocomplete(true);
        setSelectedAutocompleteIndex(-1);
      } else {
        setShowAutocomplete(false);
        setSelectedAutocompleteIndex(-1);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [guessInput, store.currentView]);

  // Calculate matching playlist songs based on active filters in Spotify mode
  const matchingPlaylistSongs = useMemo(() => {
    if (!store.importedPlaylist || !store.importedPlaylist.tracks) return [];
    return store.importedPlaylist.tracks.filter((t) => {
      if (!t.hasPlayablePreview) return false;

      // Difficulty filter
      if (store.difficulty && (store.difficulty as string) !== 'all') {
        const cfg = DIFFICULTY_CONFIGS[store.difficulty];
        if (cfg) {
          if (t.popularityScore < cfg.popularityMin || t.popularityScore > cfg.popularityMax) {
            return false;
          }
        }
      }

      // Artist filter
      if (store.artist.trim()) {
        const cleanArt = store.artist.trim().toLowerCase();
        if (!t.artist.toLowerCase().includes(cleanArt)) {
          return false;
        }
      }

      // Era filter
      if (store.era && store.era !== 'all') {
        let yMin = 0;
        let yMax = 3000;
        if (store.era === '1970s') { yMin = 1970; yMax = 1979; }
        else if (store.era === '1980s') { yMin = 1980; yMax = 1989; }
        else if (store.era === '1990s') { yMin = 1990; yMax = 1999; }
        else if (store.era === '2000s') { yMin = 2000; yMax = 2009; }
        else if (store.era === '2010s') { yMin = 2010; yMax = 2019; }
        else if (store.era === '2020s') { yMin = 2020; yMax = 2029; }

        if (t.releaseYear < yMin || t.releaseYear > yMax) {
          return false;
        }
      }

      return true;
    });
  }, [store.importedPlaylist, store.difficulty, store.artist, store.era]);

  // Global keyboard shortcuts (Space to play/advance, Escape to dismiss autocomplete)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        setShowAutocomplete(false);
        return;
      }

      // Spacebar triggers play when in game and not typing in input
      if (e.code === 'Space' && e.target !== inputRef.current) {
        if (store.currentView === 'game') {
          e.preventDefault();
          store.playCurrentClip();
        } else if (store.currentView === 'round-result') {
          e.preventDefault();
          handleAdvanceToNextSong();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store.currentView]);

  // Handlers
  const handleSelectAutocomplete = (item: SongAutocompleteItem) => {
    setGuessInput(`${item.title} ${item.artist}`);
    setShowAutocomplete(false);
    store.clearAutocomplete();
    inputRef.current?.focus();
  };

  const handleGuessSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guessInput.trim() || store.isLoading) return;
    const submission = guessInput.trim();
    setGuessInput('');
    setShowAutocomplete(false);
    store.clearAutocomplete();
    store.submitGuess(submission);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (!showAutocomplete || store.autocompleteResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedAutocompleteIndex((prev) =>
        prev < store.autocompleteResults.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedAutocompleteIndex((prev) =>
        prev > 0 ? prev - 1 : store.autocompleteResults.length - 1
      );
    } else if (e.key === 'Enter' && selectedAutocompleteIndex >= 0) {
      e.preventDefault();
      const selected = store.autocompleteResults[selectedAutocompleteIndex];
      if (selected) {
        handleSelectAutocomplete(selected);
      }
    }
  };

  // Render view
  return (
    <div className="app-container">
      {/* Universal Header */}
      <header className="app-header">
        <button
          type="button"
          className="brand-button"
          onClick={store.returnToHome}
          aria-label="Songgest Home"
        >
          <span className="brand-title">SONGGEST</span>
          <span className="brand-tagline">Hear less. Guess more.</span>
        </button>

        <nav className="header-nav">
          {store.currentView !== 'home' && (
            <button
              type="button"
              className="btn btn-subtle"
              onClick={store.returnToHome}
            >
              Exit to Home
            </button>
          )}
          {store.currentView === 'home' && (
            <button
              type="button"
              className="btn btn-subtle"
              onClick={() => store.setCurrentView('history')}
            >
              Match History
            </button>
          )}
        </nav>
      </header>

      {/* Main Workspace */}
      <main className="main-content">
        {/* =========================================================================
            VIEW 1: HOME
           ========================================================================= */}
        {store.currentView === 'home' && (
          <section className="view-home">
            <div className="home-hero">
              <h1 className="hero-title">How quickly can you recognize this song?</h1>
              <p className="hero-subtitle">
                Listen to a fraction of a second. Guess the title and artist.
                Reveal longer clues if you get stuck.
              </p>
            </div>

            <div className="home-action-grid">
              <button
                type="button"
                className="mode-card"
                onClick={() => store.setCurrentView('quick-play-settings')}
              >
                <div className="mode-card-header">
                  <span className="mode-badge">Core Catalog</span>
                  <span className="mode-arrow">→</span>
                </div>
                <h2 className="mode-card-title">Quick Play</h2>
                <p className="mode-card-desc">
                  Play instantly with curated tracks across five difficulty levels, genres, and eras.
                </p>
              </button>

              <button
                type="button"
                className="mode-card"
                onClick={() => store.setCurrentView('spotify-import')}
              >
                <div className="mode-card-header">
                  <span className="mode-badge">Custom Pool</span>
                  <span className="mode-arrow">→</span>
                </div>
                <h2 className="mode-card-title">Play From Spotify Playlist</h2>
                <p className="mode-card-desc">
                  Paste any public Spotify playlist URL to import metadata and guess songs from your playlist.
                </p>
              </button>
            </div>

            <div className="home-footer-note">
              <span>Progressive clue reveal: 0.1s · 0.5s · 2.0s · 8.0s · 15.0s</span>
            </div>
          </section>
        )}

        {/* =========================================================================
            VIEW 2: QUICK PLAY SETTINGS
           ========================================================================= */}
        {store.currentView === 'quick-play-settings' && (
          <section className="view-settings">
            <div className="section-header">
              <h1 className="section-title">Quick Play Settings</h1>
              <p className="section-desc">Select your desired difficulty and filters before beginning.</p>
            </div>

            {store.errorMessage && (
              <div className="alert alert-error" role="alert">
                {store.errorMessage}
              </div>
            )}

            <div className="settings-form">
              {/* Difficulty Selection */}
              <div className="form-group">
                <label className="form-label" id="label-difficulty">
                  Difficulty Level
                </label>
                <div className="difficulty-grid" role="radiogroup" aria-labelledby="label-difficulty">
                  {AVAILABLE_DIFFICULTIES.map((diffKey) => {
                    const cfg = DIFFICULTY_CONFIGS[diffKey];
                    const isSelected = store.difficulty === diffKey;
                    return (
                      <button
                        key={diffKey}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        className={`chip-button ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => store.setDifficulty(diffKey)}
                      >
                        <span className="chip-title">{cfg.label}</span>
                        <span className="chip-meta">{cfg.baseMultiplier}x</span>
                        <span className="chip-desc">{cfg.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Genre Selection */}
              <div className="form-group">
                <label className="form-label" htmlFor="genre-select">
                  Genre
                </label>
                <select
                  id="genre-select"
                  className="form-select"
                  value={store.genre}
                  onChange={(e) => store.setGenre(e.target.value)}
                >
                  <option value="all">All Genres</option>
                  {(store.availableFilters?.genres || ['Pop', 'Rock', 'Electronic', 'R&B', 'Funk']).map(
                    (g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    )
                  )}
                </select>
              </div>

              {/* Era Selection */}
              <div className="form-group">
                <label className="form-label" id="label-era">
                  Era / Release Decade
                </label>
                <div className="chips-row" role="radiogroup" aria-labelledby="label-era">
                  {ERA_OPTIONS.map((eraOpt) => {
                    const isSelected = store.era === eraOpt;
                    return (
                      <button
                        key={eraOpt}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        className={`chip-pill ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => store.setEra(eraOpt)}
                      >
                        {eraOpt === 'all' ? 'All Eras' : eraOpt}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Artist Filter */}
              <div className="form-group">
                <label className="form-label" htmlFor="artist-input">
                  Artist Filter (Optional)
                </label>
                <input
                  id="artist-input"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Queen, Daft Punk"
                  value={store.artist}
                  onChange={(e) => store.setArtist(e.target.value)}
                />
              </div>

              {/* Rounds Count */}
              <div className="form-group">
                <label className="form-label" id="label-rounds">
                  Number of Songs
                </label>
                <div className="chips-row" role="radiogroup" aria-labelledby="label-rounds">
                  {ROUNDS_OPTIONS.map((count) => {
                    const isSelected = store.roundsCount === count;
                    return (
                      <button
                        key={count}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        className={`chip-pill ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => store.setRoundsCount(count)}
                      >
                        {count} Songs
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Actions */}
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={store.returnToHome}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={store.isLoading}
                  onClick={store.startQuickPlaySession}
                >
                  {store.isLoading ? 'Preparing Game...' : 'Start Game'}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* =========================================================================
            VIEW 3: SPOTIFY PLAYLIST IMPORT & SETTINGS
           ========================================================================= */}
        {store.currentView === 'spotify-import' && (
          <section className="view-settings">
            <div className="section-header">
              <h1 className="section-title">Play From Spotify Playlist</h1>
              <p className="section-desc">
                Import a public or authorized Spotify playlist to generate a custom guessing game.
              </p>
            </div>

            {/* Spotify Account Connection Bar */}
            <div className="spotify-auth-bar">
              {store.isSpotifyConnected ? (
                <div className="auth-status-connected">
                  <span className="auth-pill-active">Spotify Connected</span>
                  <span className="auth-user-name">
                    {store.spotifyUser?.displayName || store.spotifyUser?.id || 'Account Active'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={store.disconnectSpotify}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="auth-status-prompt">
                  <span className="auth-prompt-text">
                    Want to import your private or collaborative playlists?
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={store.connectSpotify}
                  >
                    Connect Spotify
                  </button>
                </div>
              )}
            </div>

            {store.importError && (
              <div className="alert alert-error" role="alert">
                <p>{store.importError}</p>
                {store.requiresSpotifyAuth && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ marginTop: 'var(--space-2)' }}
                    onClick={store.connectSpotify}
                  >
                    Connect Spotify
                  </button>
                )}
              </div>
            )}

            {!store.importedPlaylist ? (
              <div className="import-box">
                <div className="form-group">
                  <label className="form-label" htmlFor="spotify-url-input">
                    Spotify Playlist URL
                  </label>
                  <div className="input-with-button">
                    <input
                      id="spotify-url-input"
                      type="url"
                      className="form-input"
                      placeholder="https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
                      value={store.spotifyUrl}
                      onChange={(e) => store.setSpotifyUrl(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={store.importLoading || !store.spotifyUrl.trim()}
                      onClick={() => store.importSpotifyPlaylist(store.spotifyUrl)}
                    >
                      {store.importLoading ? 'Importing playlist...' : 'Import Playlist'}
                    </button>
                  </div>
                </div>

                <div className="info-banner">
                  <span className="info-icon">ℹ</span>
                  <div className="info-content">
                    <p className="info-title">Audio & Preview Provider Architecture</p>
                    <p className="info-text">
                      Track metadata is imported from Spotify. Audio previews are resolved from
                      authorized preview providers without local fixture substitution. In development
                      mode without credentials, a mock provider is active.
                    </p>
                  </div>
                </div>

                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={store.returnToHome}
                  >
                    Back to Home
                  </button>
                </div>
              </div>
            ) : (
              <div className="playlist-configured-box">
                {/* Playlist Summary Card */}
                <div className="playlist-card">
                  <div className="playlist-card-top">
                    <span className="playlist-badge">Imported Playlist</span>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => store.setSpotifyUrl('')}
                    >
                      Change URL
                    </button>
                  </div>
                  <h2 className="playlist-title">{store.importedPlaylist.name}</h2>
                  {store.importedPlaylist.description && (
                    <p className="playlist-desc">{store.importedPlaylist.description}</p>
                  )}
                  {store.importedPlaylist.spotifyUrl && (
                    <a
                      href={store.importedPlaylist.spotifyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="playlist-spotify-link"
                    >
                      View on Spotify ↗
                    </a>
                  )}

                  <div className="playlist-metrics-grid">
                    <div className="metric-box">
                      <span className="metric-num">{store.importedPlaylist.totalTracks}</span>
                      <span className="metric-label">Total Tracks</span>
                    </div>
                    <div className="metric-box is-highlight">
                      <span className="metric-num">{store.importedPlaylist.playableCount}</span>
                      <span className="metric-label">Playable Clips</span>
                    </div>
                    <div className="metric-box">
                      <span className="metric-num">{store.importedPlaylist.unplayableCount}</span>
                      <span className="metric-label">Unavailable</span>
                    </div>
                  </div>

                  {store.importedPlaylist.artists && store.importedPlaylist.artists.length > 0 && (
                    <p className="playlist-artists">
                      <strong>Sample Artists:</strong> {store.importedPlaylist.artists.slice(0, 8).join(', ')}
                    </p>
                  )}
                </div>

                {/* Playlist Filter Settings */}
                <div className="settings-form">
                  {/* Difficulty */}
                  <div className="form-group">
                    <label className="form-label" id="label-diff-sp">
                      Difficulty Level
                    </label>
                    <div className="difficulty-grid" role="radiogroup" aria-labelledby="label-diff-sp">
                      {AVAILABLE_DIFFICULTIES.map((diffKey) => {
                        const cfg = DIFFICULTY_CONFIGS[diffKey];
                        const isSelected = store.difficulty === diffKey;
                        return (
                          <button
                            key={diffKey}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            className={`chip-button ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => store.setDifficulty(diffKey)}
                          >
                            <span className="chip-title">{cfg.label}</span>
                            <span className="chip-meta">{cfg.baseMultiplier}x</span>
                            <span className="chip-desc">{cfg.description}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Genre Filter */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="genre-select-sp">
                      Genre
                    </label>
                    <select
                      id="genre-select-sp"
                      className="form-select"
                      value={store.genre}
                      onChange={(e) => store.setGenre(e.target.value)}
                    >
                      <option value="all">All Genres</option>
                      {(store.importedPlaylist.genres || ['Pop', 'Rock', 'Electronic', 'Hip-Hop']).map(
                        (g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  {/* Artist Filter */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="artist-input-sp">
                      Artist Filter (Optional)
                    </label>
                    <input
                      id="artist-input-sp"
                      type="text"
                      className="form-input"
                      placeholder="e.g. Queen, Daft Punk"
                      value={store.artist}
                      onChange={(e) => store.setArtist(e.target.value)}
                    />
                  </div>

                  {/* Era Filter */}
                  <div className="form-group">
                    <label className="form-label" id="label-era-sp">
                      Era / Release Decade
                    </label>
                    <div className="chips-row" role="radiogroup" aria-labelledby="label-era-sp">
                      {ERA_OPTIONS.map((eraOpt) => {
                        const isSelected = store.era === eraOpt;
                        return (
                          <button
                            key={eraOpt}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            className={`chip-pill ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => store.setEra(eraOpt)}
                          >
                            {eraOpt === 'all' ? 'All Eras' : eraOpt}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Rounds Count */}
                  <div className="form-group">
                    <label className="form-label" id="label-rounds-sp">
                      Number of Songs
                    </label>
                    <div className="chips-row" role="radiogroup" aria-labelledby="label-rounds-sp">
                      {ROUNDS_OPTIONS.map((count) => {
                        const isSelected = store.roundsCount === count;
                        const isOver = count > matchingPlaylistSongs.length;
                        return (
                          <button
                            key={count}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            disabled={isOver}
                            className={`chip-pill ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => store.setRoundsCount(count)}
                          >
                            {count} Songs {isOver ? '(Too few matching)' : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Live Matching Pool Status */}
                  <div className="filter-summary-card">
                    <div className="summary-row">
                      <span className="summary-label">Available:</span>
                      <span className={`summary-count ${matchingPlaylistSongs.length === 0 ? 'is-zero' : ''}`}>
                        {matchingPlaylistSongs.length}
                      </span>
                    </div>
                    {matchingPlaylistSongs.length === 0 ? (
                      <div className="alert alert-error" role="alert" style={{ marginTop: 'var(--space-2)' }}>
                        No songs match your filters.
                      </div>
                    ) : (
                      <p className="filter-help-text">
                        The game session will draw strictly from these {matchingPlaylistSongs.length} matching songs.
                      </p>
                    )}
                  </div>

                  <div className="form-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => store.setCurrentView('home')}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={store.isLoading || matchingPlaylistSongs.length === 0}
                      onClick={store.startSpotifySession}
                    >
                      {store.isLoading ? 'Starting Game...' : 'START GAME'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* =========================================================================
            VIEW 4: ACTIVE GAME SCREEN
           ========================================================================= */}
        {store.currentView === 'game' && (
          <section className="view-game">
            {/* Round Status Bar */}
            <div className="game-status-bar">
              <div className="status-item">
                <span className="status-label">Song</span>
                <span className="status-value">
                  #{store.currentRoundNumber} / {store.roundsCount}
                </span>
              </div>
              <div className="status-item">
                <span className="status-label">Score</span>
                <span className="status-value">{store.totalScore.toLocaleString()}</span>
              </div>
              <div className="status-item">
                <span className="status-label">Streak</span>
                <span className="status-value">{store.currentStreak} 🔥</span>
              </div>
            </div>

            {/* Progressive Stage Stepper */}
            <div className="progressive-tracker" aria-label="Audio clue stages">
              {PROGRESSIVE_STAGES.map((stg) => {
                const isPast = stg.stageIndex < store.currentStageIndex;
                const isCurrent = stg.stageIndex === store.currentStageIndex;
                return (
                  <div
                    key={stg.stageIndex}
                    className={`stage-step ${isPast ? 'is-past' : ''} ${isCurrent ? 'is-current' : ''}`}
                  >
                    <span className="step-duration">{stg.label}</span>
                    <span className="step-multiplier">{stg.multiplier}x</span>
                  </div>
                );
              })}
            </div>

            {/* Audio Deck Surface */}
            <div className="audio-deck-panel">
              <button
                type="button"
                className={`play-trigger-button ${store.isAudioPlaying ? 'is-playing' : ''}`}
                onClick={store.playCurrentClip}
                aria-label={`Play clip: ${store.currentStageDuration} seconds`}
              >
                <span className="play-icon">{store.isAudioPlaying ? '❚❚' : '▶'}</span>
                <span className="play-text">PLAY CLIP {store.currentStageDuration}s</span>
              </button>
              <span className="play-shortcut-hint">Press Spacebar to play</span>
            </div>

            {/* Feedback / Clue notification */}
            {store.guessFeedback && (
              <div className="alert alert-info" role="status">
                {store.guessFeedback}
              </div>
            )}

            {store.statusMessage && (
              <div className="alert alert-info" role="status">
                {store.statusMessage}
              </div>
            )}

            {store.errorMessage && (
              <div className="alert alert-error" role="alert">
                {store.errorMessage}
              </div>
            )}

            {/* Guess & Search Input */}
            <form onSubmit={handleGuessSubmit} className="guess-form">
              <div className="autocomplete-wrapper">
                <input
                  ref={inputRef}
                  type="text"
                  className="form-input guess-input"
                  placeholder="Search for a song or artist..."
                  value={guessInput}
                  onChange={(e) => setGuessInput(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-expanded={showAutocomplete}
                />

                {showAutocomplete && store.autocompleteResults.length > 0 && (
                  <ul className="autocomplete-dropdown" role="listbox">
                    {store.autocompleteResults.map((item, idx) => (
                      <li
                        key={`${item.id}-${idx}`}
                        role="option"
                        aria-selected={idx === selectedAutocompleteIndex}
                        className={`autocomplete-item ${
                          idx === selectedAutocompleteIndex ? 'is-highlighted' : ''
                        }`}
                        onClick={() => handleSelectAutocomplete(item)}
                      >
                        <span className="item-title">{item.title}</span>
                        <span className="item-artist">{item.artist}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="game-action-buttons">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={store.isLoading}
                  onClick={store.skipCurrentStage}
                >
                  {store.currentStageIndex >= 4 ? 'Give Up / Reveal Song' : 'Skip Stage (+Clue)'}
                </button>

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={store.isLoading || !guessInput.trim()}
                >
                  Submit Guess
                </button>
              </div>
            </form>
          </section>
        )}

        {/* =========================================================================
            VIEW 5: ROUND RESULT
           ========================================================================= */}
        {store.currentView === 'round-result' && store.lastResult && (
          <section className="view-result">
            {store.lastResult.isCorrect ? (
              <div className="result-banner is-correct">
                <span className="result-symbol">✓</span>
                <div className="result-text-group">
                  <h1 className="result-status-title">Correct!</h1>
                  <span className="result-points-pill">+{store.lastResult.pointsAwarded} pts</span>
                </div>
              </div>
            ) : store.lastResult.isPartial ? (
              <div className="result-banner is-partial">
                <span className="result-symbol">~</span>
                <div className="result-text-group">
                  <h1 className="result-status-title">Artist Match!</h1>
                  <span className="result-points-pill">+{store.lastResult.pointsAwarded} pts</span>
                </div>
              </div>
            ) : (
              <div className="result-banner is-incorrect">
                <span className="result-symbol">✕</span>
                <div className="result-text-group">
                  <h1 className="result-status-title">Incorrect</h1>
                  <span className="result-points-pill">+0 pts</span>
                </div>
              </div>
            )}

            {/* Revealed Song Card */}
            {store.lastResult.revealedSong && (
              <div className="revealed-song-card">
                <div className="revealed-song-main">
                  {store.lastResult.revealedSong.albumArtUrl ? (
                    <img
                      src={store.lastResult.revealedSong.albumArtUrl}
                      alt={`Album artwork for ${store.lastResult.revealedSong.title}`}
                      className="revealed-album-art"
                      loading="lazy"
                    />
                  ) : (
                    <div className="revealed-album-placeholder" aria-label="No album artwork available">
                      <span className="album-placeholder-icon">🎵</span>
                    </div>
                  )}

                  <div className="revealed-info-col">
                    <span className="revealed-card-label">Guessed Song</span>
                    <h2 className="revealed-song-title">{store.lastResult.revealedSong.title}</h2>
                    <p className="revealed-song-artist">{store.lastResult.revealedSong.artist}</p>

                    <div className="revealed-song-meta">
                      {store.lastResult.revealedSong.album && (
                        <span className="meta-badge">Album: {store.lastResult.revealedSong.album}</span>
                      )}
                      <span className="meta-badge">Year: {store.lastResult.revealedSong.releaseYear}</span>
                      <span className="meta-badge">Genre: {store.lastResult.revealedSong.genre}</span>
                    </div>
                  </div>
                </div>

                {/* Audio Preview Snippet Player */}
                {store.lastResult.revealedSong.previewUrl && (
                  <div className="revealed-player-deck">
                    <audio
                      ref={revealedAudioRef}
                      src={store.lastResult.revealedSong.previewUrl}
                      onEnded={() => setIsRevealedAudioPlaying(false)}
                      onError={() => setIsRevealedAudioPlaying(false)}
                      preload="none"
                    />
                    <button
                      type="button"
                      className={`btn btn-preview-play ${isRevealedAudioPlaying ? 'is-playing' : ''}`}
                      onClick={toggleRevealedAudio}
                      aria-label={isRevealedAudioPlaying ? 'Pause audio preview' : 'Play song preview snippet'}
                    >
                      <span className="btn-icon">{isRevealedAudioPlaying ? '❚❚' : '▶'}</span>
                      <span>{isRevealedAudioPlaying ? 'Pause Preview' : 'Play Song Preview Snippet'}</span>
                    </button>

                    {store.lastResult.revealedSong.externalUrl && (
                      <a
                        href={store.lastResult.revealedSong.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-spotify-link"
                        aria-label={`Open ${store.lastResult.revealedSong.title} on Spotify`}
                      >
                        <span className="spotify-icon">♫</span>
                        <span>Listen on Spotify ↗</span>
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="result-actions">
              <button
                type="button"
                className="btn btn-primary btn-large"
                disabled={store.isLoading}
                onClick={handleAdvanceToNextSong}
              >
                {store.roundResults.length >= store.roundsCount ? 'View Final Results' : 'Next Song →'}
              </button>
              <span className="play-shortcut-hint">Or press Spacebar to proceed</span>
            </div>
          </section>
        )}

        {/* =========================================================================
            VIEW 6: FINAL RESULTS
           ========================================================================= */}
        {store.currentView === 'final-results' && (
          <section className="view-final">
            <div className="section-header">
              <h1 className="section-title">Game Complete</h1>
              <p className="section-desc">
                {store.sourceType === 'SPOTIFY_PLAYLIST' && store.importedPlaylist
                  ? `Playlist: ${store.importedPlaylist.name}`
                  : `Mode: Quick Play (${store.difficulty.toUpperCase()})`}
              </p>
            </div>

            {/* Summary Metrics Grid */}
            <div className="metrics-summary-grid">
              <div className="summary-stat-card">
                <span className="stat-value">{store.totalScore.toLocaleString()}</span>
                <span className="stat-label">Final Score</span>
              </div>
              <div className="summary-stat-card">
                <span className="stat-value">
                  {store.roundResults.filter((r) => r.isCorrect).length} / {store.roundResults.length}
                </span>
                <span className="stat-label">Correct Songs</span>
              </div>
              <div className="summary-stat-card">
                <span className="stat-value">
                  {store.roundResults.length > 0
                    ? Math.round(
                        (store.roundResults.filter((r) => r.isCorrect).length /
                          store.roundResults.length) *
                          100
                      )
                    : 0}
                  %
                </span>
                <span className="stat-label">Accuracy</span>
              </div>
            </div>

            {/* Recap Table */}
            <div className="recap-list">
              <h2 className="recap-title">Round Summary</h2>
              {store.roundResults.map((r, i) => (
                <div key={i} className="recap-row">
                  <span className="recap-round">#{r.roundNumber}</span>
                  {r.revealedSong.albumArtUrl ? (
                    <img
                      src={r.revealedSong.albumArtUrl}
                      alt={`Album artwork for ${r.revealedSong.title}`}
                      className="recap-album-thumb"
                      loading="lazy"
                    />
                  ) : (
                    <div className="recap-album-placeholder" aria-label="Song">🎵</div>
                  )}
                  <div className="recap-song-details">
                    <span className="recap-song-title">{r.revealedSong.title}</span>
                    <span className="recap-song-artist">{r.revealedSong.artist}</span>
                  </div>
                  <div className="recap-result-tag">
                    {r.isCorrect ? (
                      <span className="tag-correct">✓ {r.pointsAwarded} pts</span>
                    ) : r.isPartial ? (
                      <span className="tag-partial">~ {r.pointsAwarded} pts</span>
                    ) : (
                      <span className="tag-incorrect">✕ Missed</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={store.returnToHome}
              >
                Back to Home
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (store.sourceType === 'SPOTIFY_PLAYLIST') {
                    store.startSpotifySession();
                  } else {
                    store.startQuickPlaySession();
                  }
                }}
              >
                Play Again
              </button>
            </div>
          </section>
        )}

        {/* =========================================================================
            VIEW 7: MATCH HISTORY
           ========================================================================= */}
        {store.currentView === 'history' && (
          <section className="view-history">
            <div className="section-header">
              <h1 className="section-title">Recent Matches</h1>
              <p className="section-desc">Performance history from completed guessing sessions.</p>
            </div>

            {store.historyLoading ? (
              <p className="history-empty">Loading history records...</p>
            ) : !store.historyStats || store.historyStats.recentGames.length === 0 ? (
              <div className="history-empty">
                <p>No games completed yet. Play a game to view match history!</p>
              </div>
            ) : (
              <div className="history-list">
                {store.historyStats.recentGames.map((game) => (
                  <div key={game.id} className="history-item">
                    <div className="history-item-left">
                      <span className="history-source">
                        {game.sourceType === 'SPOTIFY_PLAYLIST' ? (game.playlistName ? `Playlist: ${game.playlistName}` : 'Spotify Playlist') : 'Quick Play'}
                      </span>
                      <span className="history-date">
                        {new Date(game.completedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </span>
                    </div>
                    <div className="history-item-right">
                      <span className="history-score">{game.finalScore.toLocaleString()} pts</span>
                      <span className="history-accuracy">
                        {game.correctAnswers} / {game.roundsPlayed} ({Math.round(game.accuracy * 100)}%)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={store.returnToHome}
              >
                Back to Home
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
