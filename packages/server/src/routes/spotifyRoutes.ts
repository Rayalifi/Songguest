import crypto from 'crypto';
import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db/client.js';
import { spotifyClient } from '../providers/spotify/spotifyClient.js';
import { getImportedPlaylist, importSpotifyPlaylist } from '../providers/spotify/spotifyService.js';
import { checkRateLimit, globalLimiter } from '../middleware/rateLimiter.js';
import { ValidationError, validateId } from '../utils/validation.js';

export const spotifyRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/spotify/auth-url - Generate Spotify OAuth authorization URL with CSRF state
  fastify.get('/api/spotify/auth-url', async (req, reply) => {
    if (!checkRateLimit(req, reply, globalLimiter, 30)) {
      return;
    }

    if (!spotifyClient.isConfigured()) {
      return reply.status(503).send({
        error: 'SPOTIFY_NOT_CONFIGURED',
        message: 'Spotify integration is not configured. Please set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.'
      });
    }

    const state = crypto.randomBytes(24).toString('hex');

    // Create session placeholder in database with state
    await prisma.spotifyAuthSession.create({
      data: {
        state
      }
    });

    try {
      const authUrl = spotifyClient.getAuthorizeUrl(state);
      return reply.status(200).send({
        authUrl,
        state
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate Spotify authorization URL.';
      return reply.status(500).send({
        error: 'AUTH_URL_FAILED',
        message
      });
    }
  });

  // GET /api/spotify/callback - Handle official Spotify OAuth callback
  fastify.get<{
    Querystring: {
      code?: string;
      state?: string;
      error?: string;
    };
  }>('/api/spotify/callback', async (req, reply) => {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      return reply.status(400).send({
        error: 'SPOTIFY_AUTH_DENIED',
        message: `Spotify authorization was denied: ${oauthError}`
      });
    }

    if (!code || !state) {
      return reply.status(400).send({
        error: 'INVALID_CALLBACK_PARAMS',
        message: 'Missing code or state in OAuth callback.'
      });
    }

    // Verify state matches our pending session
    const authSession = await prisma.spotifyAuthSession.findUnique({
      where: { state }
    });

    if (!authSession) {
      return reply.status(400).send({
        error: 'INVALID_AUTH_STATE',
        message: 'Invalid or expired state parameter. Please try connecting again.'
      });
    }

    try {
      // Exchange code for tokens
      const tokenData = await spotifyClient.exchangeCodeForToken(code);
      const userProfile = await spotifyClient.getUserProfile(tokenData.accessToken);

      const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000);

      const updatedSession = await prisma.spotifyAuthSession.update({
        where: { id: authSession.id },
        data: {
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken || null,
          expiresAt,
          scope: tokenData.scope || null,
          spotifyUserId: userProfile.id,
          displayName: userProfile.displayName || null
        }
      });

      // If client requests JSON, return session details
      const acceptHeader = req.headers.accept || '';
      if (acceptHeader.includes('application/json')) {
        return reply.status(200).send({
          success: true,
          sessionId: updatedSession.id,
          user: {
            id: userProfile.id,
            displayName: userProfile.displayName
          }
        });
      }

      // Otherwise redirect to frontend application with session token
      const frontendOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
      const redirectTarget = `${frontendOrigin}/?spotify_connected=true&session_token=${encodeURIComponent(updatedSession.id)}`;
      return reply.redirect(redirectTarget);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to complete Spotify authorization.';
      return reply.status(400).send({
        error: 'TOKEN_EXCHANGE_FAILED',
        message
      });
    }
  });

  // GET /api/spotify/status - Check Spotify user authorization status
  fastify.get('/api/spotify/status', async (req, reply) => {
    const sessionToken =
      (req.headers['x-spotify-session'] as string | undefined) ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7).trim()
        : undefined);

    if (!sessionToken) {
      return reply.status(200).send({
        isConnected: false,
        isConfigured: spotifyClient.isConfigured()
      });
    }

    const session = await prisma.spotifyAuthSession.findUnique({
      where: { id: sessionToken }
    });

    if (!session || !session.accessToken || (session.expiresAt && session.expiresAt < new Date())) {
      return reply.status(200).send({
        isConnected: false,
        isConfigured: spotifyClient.isConfigured()
      });
    }

    return reply.status(200).send({
      isConnected: true,
      isConfigured: spotifyClient.isConfigured(),
      spotifyUserId: session.spotifyUserId || undefined,
      displayName: session.displayName || undefined
    });
  });

  // POST /api/spotify/disconnect - Disconnect user Spotify account
  fastify.post('/api/spotify/disconnect', async (req, reply) => {
    const sessionToken =
      (req.headers['x-spotify-session'] as string | undefined) ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7).trim()
        : undefined);

    if (sessionToken) {
      await prisma.spotifyAuthSession.deleteMany({
        where: { id: sessionToken }
      });
    }

    return reply.status(200).send({ success: true });
  });

  // POST /api/spotify/playlists/import - Validate Spotify URL and import playlist metadata into game pool
  fastify.post('/api/spotify/playlists/import', async (req, reply) => {
    if (!checkRateLimit(req, reply, globalLimiter, 30)) {
      return;
    }

    const body = req.body as { url?: string } | undefined;
    if (!body || typeof body !== 'object' || !body.url) {
      return reply.status(400).send({
        error: 'MISSING_URL',
        message: 'A Spotify playlist URL is required in the request body.'
      });
    }

    // Check if a user session token was provided for private playlist access
    const sessionToken =
      (req.headers['x-spotify-session'] as string | undefined) ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7).trim()
        : undefined);

    let userAccessToken: string | undefined;
    if (sessionToken) {
      const authSession = await prisma.spotifyAuthSession.findUnique({
        where: { id: sessionToken }
      });
      if (authSession && authSession.accessToken && (!authSession.expiresAt || authSession.expiresAt > new Date())) {
        userAccessToken = authSession.accessToken;
      }
    }

    try {
      const importResult = await importSpotifyPlaylist(body.url, userAccessToken);
      return reply.status(200).send(importResult);
    } catch (err: unknown) {
      if (err instanceof ValidationError) {
        return reply.status(err.statusCode).send({
          error: err.code,
          message: err.message
        });
      }

      const code = (err as unknown as { code?: string })?.code;
      const message = err instanceof Error ? err.message : 'Spotify playlist import failed.';

      if (code === 'INVALID_SPOTIFY_URL') {
        return reply.status(400).send({ error: 'INVALID_SPOTIFY_URL', message });
      }
      if (code === 'PLAYLIST_NOT_FOUND') {
        return reply.status(404).send({ error: 'PLAYLIST_NOT_FOUND', message });
      }
      if (code === 'NO_PLAYABLE_TRACKS') {
        return reply.status(400).send({ error: 'NO_PLAYABLE_TRACKS', message });
      }
      if (code === 'PLAYLIST_ACCESS_RESTRICTED') {
        return reply.status(403).send({ error: 'PLAYLIST_ACCESS_RESTRICTED', message });
      }
      if (code === 'SPOTIFY_AUTH_REQUIRED' || code === 'SPOTIFY_AUTH_FAILED') {
        return reply.status(401).send({
          error: 'SPOTIFY_AUTH_REQUIRED',
          message: 'Spotify authorization required or playlist is private. Please connect your Spotify account.'
        });
      }
      if (code === 'SPOTIFY_RATE_LIMITED') {
        return reply.status(429).send({ error: 'SPOTIFY_RATE_LIMITED', message });
      }

      return reply.status(400).send({ error: 'SPOTIFY_IMPORT_FAILED', message });
    }
  });

  // GET /api/spotify/playlists/:id - Retrieve cached imported playlist
  fastify.get<{ Params: { id: string } }>('/api/spotify/playlists/:id', async (req, reply) => {
    if (!checkRateLimit(req, reply, globalLimiter, 60)) {
      return;
    }

    let playlistId: string;
    try {
      playlistId = validateId(req.params.id, 'id');
    } catch (valErr) {
      const err = valErr as ValidationError;
      return reply.status(400).send({ error: err.code, message: err.message });
    }

    const playlist = await getImportedPlaylist(playlistId);

    if (!playlist) {
      return reply.status(404).send({
        error: 'PLAYLIST_NOT_FOUND',
        message: 'Imported playlist does not exist in local game cache.'
      });
    }

    return reply.status(200).send({ playlist });
  });
};
