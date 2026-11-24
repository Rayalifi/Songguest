import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
}

class MemoryRateLimiter {
  private buckets: Map<string, RateLimitBucket> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(options?: RateLimiterOptions) {
    this.windowMs = options?.windowMs ?? 60 * 1000; // 1-minute window
    this.maxRequests = options?.maxRequests ?? 60; // 60 requests per window by default

    // Clean up expired buckets periodically every 2 minutes
    setInterval(() => this.cleanup(), 2 * 60 * 1000).unref();
  }

  public isAllowed(key: string, limitOverride?: number): boolean {
    const now = Date.now();
    const limit = limitOverride ?? this.maxRequests;
    const bucket = this.buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (bucket.count >= limit) {
      return false;
    }

    bucket.count += 1;
    return true;
  }

  public getRemaining(key: string, limitOverride?: number): number {
    const limit = limitOverride ?? this.maxRequests;
    const bucket = this.buckets.get(key);
    if (!bucket || Date.now() > bucket.resetAt) return limit;
    return Math.max(0, limit - bucket.count);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets.entries()) {
      if (now > bucket.resetAt) {
        this.buckets.delete(key);
      }
    }
  }

  public reset(): void {
    this.buckets.clear();
  }
}

export const globalLimiter = new MemoryRateLimiter({ windowMs: 60 * 1000, maxRequests: 120 });
export const sessionCreationLimiter = new MemoryRateLimiter({ windowMs: 60 * 1000, maxRequests: 20 });
export const guessLimiter = new MemoryRateLimiter({ windowMs: 60 * 1000, maxRequests: 60 });

export function checkRateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  limiter: MemoryRateLimiter,
  limitOverride?: number
): boolean {
  // Allow test suite bypass unless testing rate limit specifically via header
  if (process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
    return true;
  }

  const clientIp = req.ip || req.headers['x-forwarded-for']?.toString() || '127.0.0.1';
  const isAllowed = limiter.isAllowed(clientIp, limitOverride);

  if (!isAllowed) {
    reply.status(429).send({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please slow down and try again later.'
    });
    return false;
  }

  return true;
}
