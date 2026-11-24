import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './index.js';
import { prisma } from './db/client.js';
import { seedDatabase } from './db/seed.js';
import { validateSpotifyUrl } from './utils/validation.js';
import { spotifyClient, SPOTIFY_AUTH_SCOPES } from './providers/spotify/spotifyClient.js';
import { importSpotifyPlaylist } from './providers/spotify/spotifyService.js';
import {
  compositePreviewProvider,
  deezerPreviewProvider,
  itunesPreviewProvider,
  spotifyNativePreviewProvider
} from './providers/preview/index.js';

describe('Songgest Spotify Migration & Real Preview Provider Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await seedDatabase();
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('PHASE 4 & 5: Spotify URL Parsing and Validation', () => {
    it('extracts playlist ID from standard HTTPS URL', () => {
      const id = validateSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
      expect(id).toBe('37i9dQZF1DXcBWIGoYBM5M');
    });

    it('extracts playlist ID from URL with query parameters', () => {
      const id = validateSpotifyUrl(
        'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=e2f8263541c448bb&pt=abc123xyz'
      );
      expect(id).toBe('37i9dQZF1DXcBWIGoYBM5M');
    });

    it('extracts playlist ID from user-specific playlist URL', () => {
      const id = validateSpotifyUrl(
        'https://open.spotify.com/user/spotify/playlist/37i9dQZF1DXcBWIGoYBM5M'
      );
      expect(id).toBe('37i9dQZF1DXcBWIGoYBM5M');
    });

    it('extracts playlist ID from spotify URI format', () => {
      const id = validateSpotifyUrl('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
      expect(id).toBe('37i9dQZF1DXcBWIGoYBM5M');
    });

    it('rejects unsupported Spotify track URLs', () => {
      expect(() => {
        validateSpotifyUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
      }).toThrow('Only playlist URLs are supported.');
    });

    it('rejects unsupported Spotify album URLs', () => {
      expect(() => {
        validateSpotifyUrl('https://open.spotify.com/album/4LH4d3cOWNNXdurDSVkVuG');
      }).toThrow('Only playlist URLs are supported.');
    });

    it('rejects unsupported Spotify artist URLs', () => {
      expect(() => {
        validateSpotifyUrl('https://open.spotify.com/artist/06HL4z0CvFAxyc27GXpf02');
      }).toThrow('Only playlist URLs are supported.');
    });

    it('rejects invalid or malformed non-Spotify URLs', () => {
      expect(() => {
        validateSpotifyUrl('https://example.com/not-a-spotify-url');
      }).toThrow('valid Spotify playlist');
    });

    it('rejects URLs exceeding maximum length', () => {
      const hugeUrl = `https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?param=${'a'.repeat(600)}`;
      expect(() => {
        validateSpotifyUrl(hugeUrl);
      }).toThrow('maximum allowed length');
    });
  });

  describe('PHASE 2 & 3: Spotify OAuth Authentication', () => {
    it('requests only minimum necessary scopes and forbids excess permissions', () => {
      expect(SPOTIFY_AUTH_SCOPES).toBe('playlist-read-private playlist-read-collaborative');
      expect(SPOTIFY_AUTH_SCOPES).not.toContain('playlist-modify');
      expect(SPOTIFY_AUTH_SCOPES).not.toContain('user-library');
      expect(SPOTIFY_AUTH_SCOPES).not.toContain('streaming');
    });

    it('rejects OAuth callback with missing parameters', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/spotify/callback'
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_CALLBACK_PARAMS');
    });

    it('rejects OAuth callback with invalid state parameter (CSRF protection)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/spotify/callback?code=mock_code&state=non_existent_state_12345'
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('INVALID_AUTH_STATE');
    });

    it('reports unauthenticated status when no session token is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/spotify/status'
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.isConnected).toBe(false);
    });

    it('handles user disconnect and session invalidation', async () => {
      // Create a test session
      const testSession = await prisma.spotifyAuthSession.create({
        data: {
          state: 'test_state_disco',
          accessToken: 'test_token',
          displayName: 'Test User'
        }
      });

      const disconnectRes = await app.inject({
        method: 'POST',
        url: '/api/spotify/disconnect',
        headers: {
          'x-spotify-session': testSession.id
        }
      });

      expect(disconnectRes.statusCode).toBe(200);
      expect(JSON.parse(disconnectRes.body).success).toBe(true);

      const found = await prisma.spotifyAuthSession.findUnique({
        where: { id: testSession.id }
      });
      expect(found).toBeNull();
    });
  });

  describe('PHASE 4, 5 & 6: Playlist Import and Accurate Track Mapping', () => {
    it('returns exact Phase 4 contract with playable/unavailable breakdown', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/spotify/playlists/import',
        payload: {
          url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'
        }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      // Verify Phase 4 contract
      expect(body.playlist).toBeDefined();
      expect(body.playlist.id).toBe('37i9dQZF1DXcBWIGoYBM5M');
      expect(body.playlist.name).toBeDefined();
      expect(body.playlist.spotifyUrl).toContain('open.spotify.com/playlist');
      expect(body.totalTracks).toBeGreaterThanOrEqual(10);
      expect(body.playableTracks).toBeGreaterThanOrEqual(1);
      expect(body.unavailableTracks).toBeGreaterThanOrEqual(1);
      expect(body.playableTracks + body.unavailableTracks).toBe(body.totalTracks);
      expect(Array.isArray(body.tracks)).toBe(true);

      // Verify Phase 5 metadata mapping on tracks
      const firstTrack = body.tracks[0];
      expect(firstTrack.id).toBeDefined();
      expect(firstTrack.title).toBeDefined();
      expect(firstTrack.artist).toBeDefined();
      expect(firstTrack.releaseYear).toBeGreaterThan(1900);
      expect(firstTrack.externalSpotifyUrl).toContain('open.spotify.com/track');
    });

    it('never assigns fake fixture_*.wav to real Spotify tracks in database', async () => {
      const playlistId = '37i9dQZF1DXcBWIGoYBM5X';

      // Test directly with importSpotifyPlaylist
      const result = await importSpotifyPlaylist(
        `https://open.spotify.com/playlist/${playlistId}`
      );
      expect(result.playableTracks).toBeGreaterThan(0);

      const dbSongs = await prisma.song.findMany({
        where: { spotifyPlaylistId: playlistId }
      });

      expect(dbSongs.length).toBe(result.playableTracks);
      for (const song of dbSongs) {
        expect(song.provider).toBe('spotify-mock-dev');
        expect(song.spotifyTrackId).toBeDefined();
        expect(song.externalUrl).toContain('open.spotify.com/track');
      }
    });

    it('excludes unavailable tracks from playable pool', async () => {
      const result = await importSpotifyPlaylist(
        'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'
      );

      const unavailableTracks = result.tracks.filter((t) => !t.hasPlayablePreview);
      expect(unavailableTracks.length).toBeGreaterThan(0);

      // Verify none of the unavailable tracks were persisted as playable
      for (const unavail of unavailableTracks) {
        const dbSong = await prisma.song.findFirst({
          where: {
            spotifyPlaylistId: '37i9dQZF1DXcBWIGoYBM5M',
            spotifyTrackId: unavail.id
          }
        });
        expect(dbSong).toBeNull();
      }
    });
  });

  describe('PHASE 7 & 8: Preview Provider Architecture', () => {
    it('implements PreviewProvider interface with findPreview method', () => {
      expect(typeof itunesPreviewProvider.findPreview).toBe('function');
      expect(typeof deezerPreviewProvider.findPreview).toBe('function');
      expect(typeof spotifyNativePreviewProvider.findPreview).toBe('function');
      expect(typeof compositePreviewProvider.findPreview).toBe('function');
    });

    it('SpotifyNativePreviewProvider resolves track with spotifyPreviewUrl', async () => {
      const trackWithPreview = {
        id: 'test_spot_1',
        title: 'Song With Preview',
        artist: 'Artist',
        spotifyPreviewUrl: 'https://p.scdn.co/mp3-preview/test12345'
      };

      const result = await spotifyNativePreviewProvider.findPreview(trackWithPreview);
      expect(result.available).toBe(true);
      expect(result.previewUrl).toBe('https://p.scdn.co/mp3-preview/test12345');
      expect(result.provider).toBe('spotify-native');
      expect(result.expiresAt).toBeDefined();
    });

    it('SpotifyNativePreviewProvider returns unavailable when preview_url is null', async () => {
      const trackWithoutPreview = {
        id: 'test_spot_2',
        title: 'Song Without Preview',
        artist: 'Artist',
        spotifyPreviewUrl: null
      };

      const result = await spotifyNativePreviewProvider.findPreview(trackWithoutPreview);
      expect(result.available).toBe(false);
      expect(result.previewUrl).toBeUndefined();
    });

    it('CompositePreviewProvider tries native Spotify first and falls back without throwing', async () => {
      const track = {
        id: 'spot_test_comp',
        title: 'Random Nonexistent Song Title XZ987',
        artist: 'Unknown Artist 999',
        spotifyPreviewUrl: null
      };

      const result = await compositePreviewProvider.findPreview(track);
      expect(result.available).toBe(false);
    });
  });

  describe('PHASE 10 & 11: Game Integration, Pool Isolation & Filters', () => {
    const playlistId = '37i9dQZF1DXcBWIGoYBM5M';

    beforeAll(async () => {
      await app.inject({
        method: 'POST',
        url: '/api/spotify/playlists/import',
        payload: { url: `https://open.spotify.com/playlist/${playlistId}` }
      });
    });

    it('creates game session using ONLY playable tracks from imported playlist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sourceType: 'SPOTIFY_PLAYLIST',
          playlistId,
          roundsCount: 3
        }
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);
      expect(data.session.sourceType).toBe('SPOTIFY_PLAYLIST');

      // Verify first round song belongs to this playlist
      const ticket = await prisma.roundTicket.findUnique({
        where: { ticketId: data.firstRound.ticketId },
        include: { song: true }
      });
      expect(ticket?.song.spotifyPlaylistId).toBe(playlistId);
    });

    it('applies difficulty filter to playlist pool', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sourceType: 'SPOTIFY_PLAYLIST',
          playlistId,
          difficulty: 'easy', // Popularity 80-100
          roundsCount: 3
        }
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);

      const ticket = await prisma.roundTicket.findUnique({
        where: { ticketId: data.firstRound.ticketId },
        include: { song: true }
      });
      expect(ticket?.song.popularityScore).toBeGreaterThanOrEqual(80);
    });

    it('applies artist filter to playlist pool', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sourceType: 'SPOTIFY_PLAYLIST',
          playlistId,
          artist: 'Funk Dynasty',
          roundsCount: 2
        }
      });

      expect(res.statusCode).toBe(201);
      const data = JSON.parse(res.body);

      const ticket = await prisma.roundTicket.findUnique({
        where: { ticketId: data.firstRound.ticketId },
        include: { song: true }
      });
      expect(ticket?.song.artist).toContain('Funk Dynasty');
    });

    it('returns exact error when zero tracks match selected filters and does NOT silently fall back', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sourceType: 'SPOTIFY_PLAYLIST',
          playlistId,
          artist: 'Nonexistent Artist Name In This Playlist',
          roundsCount: 3
        }
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.message).toBe('No songs match your filters.');
      expect(data.availableCount).toBe(0);
    });
  });

  describe('PHASE 12 & 13: Progressive Audio and Security Enforcement', () => {
    it('executes progressive stages: 0.1s -> 0.5s -> 2.0s -> 8.0s -> 15.0s', async () => {
      const playlistId = '37i9dQZF1DXcBWIGoYBM5M';

      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sourceType: 'SPOTIFY_PLAYLIST',
          playlistId,
          roundsCount: 1
        }
      });
      expect(sessionRes.statusCode).toBe(201);
      const sessionData = JSON.parse(sessionRes.body);
      let ticketId = sessionData.firstRound.ticketId;
      const sessionId = sessionData.session.id;

      // Stage 0: 0.1s
      expect(sessionData.firstRound.durationSec).toBe(0.1);
      expect(sessionData.firstRound.stageIndex).toBe(0);

      // Skip to Stage 1: 0.5s
      const skip1 = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/skip`,
        payload: { ticketId }
      });
      expect(skip1.statusCode).toBe(200);
      const data1 = JSON.parse(skip1.body);
      expect(data1.durationSec).toBe(0.5);
      expect(data1.stageIndex).toBe(1);
      expect(data1.isRevealed).toBe(false);

      // Skip to Stage 2: 2.0s
      const skip2 = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/skip`,
        payload: { ticketId }
      });
      const data2 = JSON.parse(skip2.body);
      expect(data2.durationSec).toBe(2.0);
      expect(data2.stageIndex).toBe(2);

      // Skip to Stage 3: 8.0s
      const skip3 = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/skip`,
        payload: { ticketId }
      });
      const data3 = JSON.parse(skip3.body);
      expect(data3.durationSec).toBe(8.0);
      expect(data3.stageIndex).toBe(3);

      // Skip to Stage 4: 15.0s
      const skip4 = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/skip`,
        payload: { ticketId }
      });
      const data4 = JSON.parse(skip4.body);
      expect(data4.durationSec).toBe(15.0);
      expect(data4.stageIndex).toBe(4);

      // Skip on final stage reveals song and completes round
      const skipFinal = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/skip`,
        payload: { ticketId }
      });
      const dataFinal = JSON.parse(skipFinal.body);
      expect(dataFinal.isRevealed).toBe(true);
      expect(dataFinal.revealedSong).toBeDefined();
    });

    it('enforces single-use ticket protection on audio streaming endpoint', async () => {
      const playlistId = '37i9dQZF1DXcBWIGoYBM5M';

      const sessionRes = await app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: {
          sourceType: 'SPOTIFY_PLAYLIST',
          playlistId,
          roundsCount: 1
        }
      });
      const sessionData = JSON.parse(sessionRes.body);
      const ticketId = sessionData.firstRound.ticketId;
      const sessionId = sessionData.session.id;

      // Stream audio with valid ticket
      const audioRes = await app.inject({
        method: 'GET',
        url: `/api/audio/${ticketId}`
      });
      expect(audioRes.statusCode).toBe(200);

      // Mark ticket as used via guess submission
      const guessRes = await app.inject({
        method: 'POST',
        url: `/api/sessions/${sessionId}/guess`,
        payload: {
          ticketId,
          guessText: 'Neon Horizon',
          reactionTimeMs: 1200
        }
      });
      expect(guessRes.statusCode).toBe(200);

      // Attempting to stream with already used ticket must fail with 409
      const replayAudioRes = await app.inject({
        method: 'GET',
        url: `/api/audio/${ticketId}`
      });
      expect(replayAudioRes.statusCode).toBe(409);
      expect(JSON.parse(replayAudioRes.body).error).toBe('TICKET_ALREADY_USED');
    });
  });
});
