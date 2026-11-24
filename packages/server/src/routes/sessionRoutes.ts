import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  createGameSession,
  createNextRoundTicket,
  getGameSession,
  skipRoundStage,
  submitRoundGuess
} from '../services/sessionService.js';
import {
  ValidationError,
  validateGuessInput,
  validateId,
  validateSessionInput,
  validateSkipInput
} from '../utils/validation.js';
import {
  checkRateLimit,
  guessLimiter,
  sessionCreationLimiter
} from '../middleware/rateLimiter.js';

export const sessionRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/sessions - Create a new game session with validation and rate limiting
  fastify.post('/api/sessions', async (req, reply) => {
    if (!checkRateLimit(req, reply, sessionCreationLimiter, 20)) {
      return;
    }

    try {
      const validatedInput = validateSessionInput(req.body);
      const result = await createGameSession(validatedInput);
      return reply.status(201).send(result);
    } catch (err: unknown) {
      if (err instanceof ValidationError) {
        return reply.status(err.statusCode).send({
          error: err.code,
          message: err.message
        });
      }

      const code = (err as unknown as { code?: string })?.code;
      const message = err instanceof Error ? err.message : 'Internal Server Error';

      if (code === 'INSUFFICIENT_SONGS' || code === 'NO_SONGS_MATCH_FILTERS') {
        const availableCount = (err as unknown as { availableCount?: number })?.availableCount ?? 0;
        return reply.status(400).send({ error: code, message, availableCount });
      }

      return reply.status(400).send({ error: 'SESSION_CREATION_FAILED', message });
    }
  });

  // GET /api/sessions/:id - Retrieve session details and status
  fastify.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    let sessionId: string;
    try {
      sessionId = validateId(req.params.id, 'id');
    } catch (valErr) {
      const err = valErr as ValidationError;
      return reply.status(400).send({ error: err.code, message: err.message });
    }

    const session = await getGameSession(sessionId);

    if (!session) {
      return reply.status(404).send({
        error: 'SESSION_NOT_FOUND',
        message: 'Session does not exist.'
      });
    }

    return reply.status(200).send({ session });
  });

  // Handler for next round generation
  const handleNextRound = async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    let sessionId: string;
    try {
      sessionId = validateId(req.params.id, 'id');
    } catch (valErr) {
      const err = valErr as ValidationError;
      return reply.status(400).send({ error: err.code, message: err.message });
    }

    try {
      const nextTicket = await createNextRoundTicket(sessionId);

      if (!nextTicket) {
        return reply.status(200).send({
          isCompleted: true,
          message: 'All session rounds have been generated.'
        });
      }

      return reply.status(201).send({ nextRound: nextTicket });
    } catch (err: unknown) {
      const code = (err as unknown as { code?: string })?.code;
      const message = err instanceof Error ? err.message : 'Error generating round ticket';

      if (code === 'SESSION_NOT_FOUND') {
        return reply.status(404).send({ error: 'SESSION_NOT_FOUND', message });
      }
      if (code === 'SESSION_NOT_ACTIVE') {
        return reply.status(400).send({ error: 'SESSION_NOT_ACTIVE', message });
      }

      return reply.status(400).send({ error: 'TICKET_GENERATION_FAILED', message });
    }
  };

  // POST /api/sessions/:id/tickets - Generate next round ticket (legacy compatibility)
  fastify.post<{ Params: { id: string } }>('/api/sessions/:id/tickets', handleNextRound);

  // POST /api/sessions/:id/rounds/next - Generate next round ticket (aligned endpoint)
  fastify.post<{ Params: { id: string } }>('/api/sessions/:id/rounds/next', handleNextRound);

  // POST /api/sessions/:id/skip - Advance to next progressive clue stage or reveal on final stage
  fastify.post<{ Params: { id: string } }>('/api/sessions/:id/skip', async (req, reply) => {
    if (!checkRateLimit(req, reply, guessLimiter, 60)) {
      return;
    }

    let sessionId: string;
    try {
      sessionId = validateId(req.params.id, 'id');
    } catch (valErr) {
      const err = valErr as ValidationError;
      return reply.status(400).send({ error: err.code, message: err.message });
    }

    let validatedSkip;
    try {
      validatedSkip = validateSkipInput(req.body);
    } catch (valErr) {
      const err = valErr as ValidationError;
      return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    }

    try {
      const result = await skipRoundStage({
        sessionId,
        ticketId: validatedSkip.ticketId
      });

      return reply.status(200).send(result);
    } catch (err: unknown) {
      const code = (err as unknown as { code?: string })?.code;
      const message = err instanceof Error ? err.message : 'Error skipping round stage';

      if (code === 'TICKET_INVALID_FOR_SESSION') {
        return reply.status(403).send({ error: 'TICKET_INVALID_FOR_SESSION', message });
      }
      if (code === 'TICKET_NOT_FOUND') {
        return reply.status(404).send({ error: 'TICKET_NOT_FOUND', message });
      }
      if (code === 'TICKET_EXPIRED') {
        return reply.status(403).send({ error: 'TICKET_EXPIRED', message });
      }
      if (code === 'TICKET_ALREADY_USED') {
        return reply.status(409).send({ error: 'TICKET_ALREADY_USED', message });
      }

      return reply.status(400).send({ error: 'SKIP_FAILED', message });
    }
  });

  // POST /api/sessions/:id/guess - Submit player guess or timeout
  fastify.post<{ Params: { id: string } }>('/api/sessions/:id/guess', async (req, reply) => {
    if (!checkRateLimit(req, reply, guessLimiter, 60)) {
      return;
    }

    let sessionId: string;
    try {
      sessionId = validateId(req.params.id, 'id');
    } catch (valErr) {
      const err = valErr as ValidationError;
      return reply.status(400).send({ error: err.code, message: err.message });
    }

    let validatedGuess;
    try {
      validatedGuess = validateGuessInput(req.body);
    } catch (valErr) {
      const err = valErr as ValidationError;
      return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    }

    try {
      const result = await submitRoundGuess({
        sessionId,
        ticketId: validatedGuess.ticketId,
        guessText: validatedGuess.guessText,
        reactionTimeMs: validatedGuess.reactionTimeMs,
        advanceOnWrong: validatedGuess.advanceOnWrong,
        isTimeout: validatedGuess.isTimeout
      });

      return reply.status(200).send(result);
    } catch (err: unknown) {
      const code = (err as unknown as { code?: string })?.code;
      const message = err instanceof Error ? err.message : 'Error evaluating guess';

      if (code === 'TICKET_INVALID_FOR_SESSION') {
        return reply.status(403).send({ error: 'TICKET_INVALID_FOR_SESSION', message });
      }
      if (code === 'TICKET_NOT_FOUND') {
        return reply.status(404).send({ error: 'TICKET_NOT_FOUND', message });
      }
      if (code === 'TICKET_EXPIRED') {
        return reply.status(403).send({ error: 'TICKET_EXPIRED', message });
      }
      if (code === 'TICKET_ALREADY_USED') {
        return reply.status(409).send({ error: 'TICKET_ALREADY_USED', message });
      }

      return reply.status(400).send({ error: 'GUESS_EVALUATION_FAILED', message });
    }
  });
};
