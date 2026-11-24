import type { FastifyPluginAsync } from 'fastify';
import {
  getCatalogFilterOptions,
  queryCatalogSongs,
  searchSongCatalog
} from '../services/songCatalogService.js';
import {
  DIFFICULTY_LEVELS,
  type DifficultyLevel
} from '@songgest/shared';
import { ValidationError, validatePaginationParams } from '../utils/validation.js';
import { checkRateLimit, globalLimiter } from '../middleware/rateLimiter.js';

interface SongsQueryParams {
  difficulty?: string;
  genre?: string;
  artist?: string;
  language?: string;
  yearMin?: string;
  yearMax?: string;
  popularityMin?: string;
  popularityMax?: string;
  search?: string;
  limit?: string;
  offset?: string;
}

export const songRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/songs - Retrieve filtered song catalog
  fastify.get<{ Querystring: SongsQueryParams }>('/api/songs', async (req, reply) => {
    if (!checkRateLimit(req, reply, globalLimiter, 60)) {
      return;
    }

    const q = req.query;

    try {
      const { limit, offset } = validatePaginationParams(q.limit, q.offset);

      let difficulty: DifficultyLevel | undefined;
      if (q.difficulty) {
        if (!DIFFICULTY_LEVELS.includes(q.difficulty as DifficultyLevel)) {
          throw new ValidationError(
            'INVALID_DIFFICULTY',
            `Difficulty must be one of: ${DIFFICULTY_LEVELS.join(', ')}.`
          );
        }
        difficulty = q.difficulty as DifficultyLevel;
      }

      let yearMin: number | undefined;
      let yearMax: number | undefined;
      if (q.yearMin !== undefined && q.yearMin !== '') {
        const y = Number(q.yearMin);
        if (!Number.isInteger(y) || y < 1900 || y > 2100) {
          throw new ValidationError('INVALID_YEAR_MIN', 'yearMin must be an integer between 1900 and 2100.');
        }
        yearMin = y;
      }
      if (q.yearMax !== undefined && q.yearMax !== '') {
        const y = Number(q.yearMax);
        if (!Number.isInteger(y) || y < 1900 || y > 2100) {
          throw new ValidationError('INVALID_YEAR_MAX', 'yearMax must be an integer between 1900 and 2100.');
        }
        yearMax = y;
      }
      if (yearMin !== undefined && yearMax !== undefined && yearMin > yearMax) {
        throw new ValidationError('INVALID_YEAR_RANGE', 'yearMin cannot be greater than yearMax.');
      }

      let popMin: number | undefined;
      let popMax: number | undefined;
      if (q.popularityMin !== undefined && q.popularityMin !== '') {
        const p = Number(q.popularityMin);
        if (!Number.isInteger(p) || p < 0 || p > 100) {
          throw new ValidationError('INVALID_POPULARITY_MIN', 'popularityMin must be between 0 and 100.');
        }
        popMin = p;
      }
      if (q.popularityMax !== undefined && q.popularityMax !== '') {
        const p = Number(q.popularityMax);
        if (!Number.isInteger(p) || p < 0 || p > 100) {
          throw new ValidationError('INVALID_POPULARITY_MAX', 'popularityMax must be between 0 and 100.');
        }
        popMax = p;
      }
      if (popMin !== undefined && popMax !== undefined && popMin > popMax) {
        throw new ValidationError('INVALID_POPULARITY_RANGE', 'popularityMin cannot be greater than popularityMax.');
      }

      const search = q.search && q.search.length <= 100 ? q.search.trim() : undefined;
      const genre = q.genre && q.genre.length <= 100 ? q.genre.trim() : undefined;
      const artist = q.artist && q.artist.length <= 100 ? q.artist.trim() : undefined;
      const language = q.language && q.language.length <= 20 ? q.language.trim() : undefined;

      const songsResult = await queryCatalogSongs({
        difficulty,
        genre,
        artist,
        language,
        yearMin,
        yearMax,
        popularityMin: popMin,
        popularityMax: popMax,
        search,
        limit,
        offset
      });

      return reply.status(200).send(songsResult);
    } catch (err: unknown) {
      if (err instanceof ValidationError) {
        return reply.status(err.statusCode).send({
          error: err.code,
          message: err.message
        });
      }

      const message = err instanceof Error ? err.message : 'Error querying catalog';
      return reply.status(400).send({ error: 'CATALOG_QUERY_FAILED', message });
    }
  });

  // GET /api/songs/search - Autocomplete and title/artist search
  fastify.get<{ Querystring: { q?: string; limit?: string } }>('/api/songs/search', async (req, reply) => {
    if (!checkRateLimit(req, reply, globalLimiter, 60)) {
      return;
    }

    const queryText = (req.query.q ?? '').slice(0, 100);
    let limit = 8;
    if (req.query.limit) {
      const l = Number(req.query.limit);
      if (Number.isInteger(l) && l >= 1 && l <= 50) {
        limit = l;
      }
    }

    const results = await searchSongCatalog(queryText, limit);
    return reply.status(200).send({ results });
  });

  // GET /api/songs/filters - Retrieve available filter dimensions
  fastify.get('/api/songs/filters', async (req, reply) => {
    if (!checkRateLimit(req, reply, globalLimiter, 60)) {
      return;
    }

    const options = await getCatalogFilterOptions();
    return reply.status(200).send(options);
  });
};
