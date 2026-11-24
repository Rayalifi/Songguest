import type { FastifyPluginAsync } from 'fastify';
import { getPlayerHistoryStats } from '../services/historyService.js';
import { checkRateLimit, globalLimiter } from '../middleware/rateLimiter.js';
import { ValidationError } from '../utils/validation.js';

export const historyRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/history - Retrieve aggregate player statistics and recent games
  fastify.get('/api/history', async (req, reply) => {
    if (!checkRateLimit(req, reply, globalLimiter, 30)) {
      return;
    }

    try {
      const limitQuery = (req.query as { limit?: string })?.limit;
      let limit = 10;
      if (limitQuery !== undefined && limitQuery !== '') {
        const l = Number(limitQuery);
        if (!Number.isInteger(l) || l < 1 || l > 50) {
          throw new ValidationError('INVALID_LIMIT', 'Limit must be an integer between 1 and 50.');
        }
        limit = l;
      }

      const stats = await getPlayerHistoryStats(limit);
      return reply.status(200).send(stats);
    } catch (err: unknown) {
      if (err instanceof ValidationError) {
        return reply.status(err.statusCode).send({
          error: err.code,
          message: err.message
        });
      }

      const message = err instanceof Error ? err.message : 'Error fetching history';
      return reply.status(400).send({ error: 'HISTORY_FETCH_FAILED', message });
    }
  });
};
