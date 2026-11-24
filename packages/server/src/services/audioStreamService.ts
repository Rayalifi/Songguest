import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import type { FastifyReply, FastifyRequest } from 'fastify';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base directory for local development audio fixtures.
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/audio');

export interface RangeParseResult {
  isRange: boolean;
  isValid: boolean;
  start: number;
  end: number;
}

// Parses and validates the HTTP Range header according to RFC 7233.
export function parseRangeHeader(rangeHeader: string | undefined, totalSize: number): RangeParseResult {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
    return { isRange: false, isValid: true, start: 0, end: totalSize - 1 };
  }

  const rangeParts = rangeHeader.replace('bytes=', '').trim().split('-');
  const rawStart = rangeParts[0];
  const rawEnd = rangeParts[1];

  let start = 0;
  let end = totalSize - 1;

  if (rawStart === '' && rawEnd !== '') {
    // Suffix byte range: bytes=-500
    const suffix = parseInt(rawEnd, 10);
    if (isNaN(suffix) || suffix <= 0) {
      return { isRange: true, isValid: false, start: 0, end: 0 };
    }
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else if (rawStart !== '' && rawEnd === '') {
    // Open-ended range: bytes=1024-
    start = parseInt(rawStart, 10);
    end = totalSize - 1;
  } else if (rawStart !== '' && rawEnd !== '') {
    // Closed range: bytes=0-1023
    start = parseInt(rawStart, 10);
    end = parseInt(rawEnd, 10);
  } else {
    return { isRange: true, isValid: false, start: 0, end: 0 };
  }

  // Validate range boundaries
  if (isNaN(start) || isNaN(end) || start < 0 || start >= totalSize || start > end) {
    return { isRange: true, isValid: false, start: 0, end: 0 };
  }

  // Cap end at last byte if client requested past EOF
  if (end >= totalSize) {
    end = totalSize - 1;
  }

  return { isRange: true, isValid: true, start, end };
}

// Streams a local audio fixture with full HTTP Range, Content-Range, and 416 support.
export async function streamAudioFixture(
  filename: string,
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const filePath = path.join(FIXTURES_DIR, filename);

  // Guard against directory traversal
  if (!filePath.startsWith(FIXTURES_DIR)) {
    return reply.status(403).send({ error: 'FORBIDDEN', message: 'Access denied.' });
  }

  if (!fs.existsSync(filePath)) {
    return reply.status(404).send({ error: 'AUDIO_NOT_FOUND', message: 'Requested audio fixture does not exist.' });
  }

  const stat = fs.statSync(filePath);
  const totalSize = stat.size;
  const rangeHeader = req.headers.range;

  const range = parseRangeHeader(rangeHeader, totalSize);

  if (range.isRange && !range.isValid) {
    reply.header('Content-Range', `bytes */${totalSize}`);
    return reply.status(416).send({ error: 'RANGE_NOT_SATISFIABLE', message: 'Requested range cannot be satisfied.' });
  }

  const contentType = filename.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';

  reply.header('Accept-Ranges', 'bytes');
  reply.header('Cache-Control', 'no-store, must-revalidate');

  if (range.isRange) {
    const chunkSize = range.end - range.start + 1;
    reply.status(206);
    reply.header('Content-Type', contentType);
    reply.header('Content-Length', chunkSize);
    reply.header('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`);

    const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
    return reply.send(stream);
  }

  // Full file stream (HTTP 200)
  reply.status(200);
  reply.header('Content-Type', contentType);
  reply.header('Content-Length', totalSize);

  const stream = fs.createReadStream(filePath);
  return reply.send(stream);
}

/**
 * Streams a remote preview audio stream (iTunes, Deezer, Spotify preview)
 * to the client with Range support and ticket authorization preservation.
 */
export async function streamRemoteAudio(
  remoteUrl: string,
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      'User-Agent': 'Songgest/0.1.0'
    };

    if (req.headers.range) {
      headers.Range = req.headers.range;
    }

    const response = await fetch(remoteUrl, { headers });

    if (!response.ok && response.status !== 206) {
      return reply.status(502).send({
        error: 'PREVIEW_STREAM_FAILED',
        message: 'Could not stream preview audio from remote provider.'
      });
    }

    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const contentLength = response.headers.get('content-length');
    const contentRange = response.headers.get('content-range');
    const acceptRanges = response.headers.get('accept-ranges') || 'bytes';

    reply.status(response.status);
    reply.header('Content-Type', contentType);
    reply.header('Accept-Ranges', acceptRanges);
    reply.header('Cache-Control', 'no-store, must-revalidate');

    if (contentLength) {
      reply.header('Content-Length', contentLength);
    }
    if (contentRange) {
      reply.header('Content-Range', contentRange);
    }

    if (!response.body) {
      return reply.send();
    }

    // Convert Web ReadableStream to Node.js Readable stream
    const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    return reply.send(nodeStream);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error streaming remote preview.';
    return reply.status(502).send({
      error: 'PREVIEW_STREAM_ERROR',
      message
    });
  }
}
