import type { FastifyPluginAsync } from 'fastify';
import { getRoundTicketWithDetails } from '../services/sessionService.js';
import { streamAudioFixture, streamRemoteAudio } from '../services/audioStreamService.js';
import { ValidationError, validateId } from '../utils/validation.js';
import { checkRateLimit, globalLimiter } from '../middleware/rateLimiter.js';
import { deezerMetadataProvider } from '../providers/deezerMetadataProvider.js';
import { prisma } from '../db/client.js';

export const audioRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/audio/:ticketId - Stream authorized audio with HTTP Range support
  fastify.get<{ Params: { ticketId: string } }>('/api/audio/:ticketId', async (req, reply) => {
    // Media streaming browsers send multiple HTTP range requests per audio snippet.
    // 300 req/min provides ample headroom without being hit by false-positive rate limits.
    if (!checkRateLimit(req, reply, globalLimiter, 300)) {
      return;
    }

    let ticketId: string;
    try {
      ticketId = validateId(req.params.ticketId, 'ticketId');
    } catch (valErr) {
      const err = valErr as ValidationError;
      return reply.status(400).send({ error: err.code, message: err.message });
    }

    const ticket = await getRoundTicketWithDetails(ticketId);

    if (!ticket) {
      return reply.status(404).send({
        error: 'TICKET_NOT_FOUND',
        message: 'The requested round ticket does not exist.'
      });
    }

    // Verify ticket expiration
    if (new Date() > ticket.expiresAt) {
      return reply.status(403).send({
        error: 'TICKET_EXPIRED',
        message: 'The round ticket has expired.'
      });
    }

    // Verify ticket has not already been marked as used
    if (ticket.status === 'used') {
      return reply.status(409).send({
        error: 'TICKET_ALREADY_USED',
        message: 'This round ticket has already been used.'
      });
    }

    // 1. If song has a local fixture file (development / test fixtures)
    if (ticket.song.audioFixturePath) {
      return streamAudioFixture(ticket.song.audioFixturePath, req, reply);
    }

    // 2. If song has an authentic preview URL (from iTunes, Deezer, or Spotify)
    if (ticket.song.previewUrl) {
      let activePreviewUrl = ticket.song.previewUrl;

      // If this is a Deezer track and its CDN token has expired, refresh it seamlessly
      if (
        ticket.song.provider === 'deezer' &&
        ticket.song.providerSongId &&
        ticket.song.previewExpiresAt &&
        new Date() > ticket.song.previewExpiresAt
      ) {
        try {
          const fresh = await deezerMetadataProvider.getPlayablePreview(ticket.song.providerSongId);
          if (fresh && fresh.previewUrl) {
            activePreviewUrl = fresh.previewUrl;
            await prisma.song.update({
              where: { id: ticket.song.id },
              data: {
                previewUrl: fresh.previewUrl,
                previewExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
              }
            });
          }
        } catch {
          // Continue with existing preview URL
        }
      }

      return streamRemoteAudio(activePreviewUrl, req, reply);
    }

    return reply.status(404).send({
      error: 'AUDIO_NOT_FOUND',
      message: 'No playable audio preview is available for this song.'
    });
  });
};
