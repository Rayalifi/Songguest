import './env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { sessionRoutes } from './routes/sessionRoutes.js';
import { audioRoutes } from './routes/audioRoutes.js';
import { songRoutes } from './routes/songRoutes.js';
import { historyRoutes } from './routes/historyRoutes.js';
import { spotifyRoutes } from './routes/spotifyRoutes.js';

export async function buildServer() {
  const isTest = process.env.NODE_ENV === 'test';
  const fastify = Fastify({
    logger: isTest ? false : true
  });

  const corsOrigin = process.env.CORS_ORIGIN
    ? (process.env.CORS_ORIGIN === '*' ? true : process.env.CORS_ORIGIN.split(',').map((s: string) => s.trim()))
    : true;

  await fastify.register(cors, {
    origin: corsOrigin
  });

  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  // Centralized error handler to sanitize output and prevent leaking stack traces or paths
  fastify.setErrorHandler((error: unknown, _request, reply) => {
    const errObj = error as { statusCode?: number; code?: string; message?: string } | null;
    const statusCode = errObj?.statusCode && errObj.statusCode >= 400 && errObj.statusCode < 600
      ? errObj.statusCode
      : 500;
    const errorCode = errObj?.code || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
    const safeMessage = statusCode === 500 ? 'An unexpected internal error occurred.' : (errObj?.message || 'Error');

    reply.status(statusCode).send({
      error: errorCode,
      message: safeMessage
    });
  });

  // Register domain route plugins
  await fastify.register(sessionRoutes);
  await fastify.register(audioRoutes);
  await fastify.register(songRoutes);
  await fastify.register(historyRoutes);
  await fastify.register(spotifyRoutes);

  return fastify;
}


if (process.argv[1] && process.argv[1].endsWith('index.ts') && process.env.NODE_ENV !== 'test') {
  const server = await buildServer();
  const port = Number(process.env.PORT) || 3001;
  server.listen({ port, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }
    server.log.info(`Songgest server listening on ${address}`);
  });
}
