import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, assertAuthenticated } from '../types';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';

const IP_API_BASE = 'http://ip-api.com/json';
const IP_API_FIELDS = 'status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,mobile,proxy,hosting,query';

export interface IpApiResponse {
  status: 'success' | 'fail';
  message?: string;
  country?: string;
  countryCode?: string;
  regionName?: string;
  city?: string;
  zip?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  isp?: string;
  org?: string;
  as?: string;
  asname?: string;
  mobile?: boolean;
  proxy?: boolean;
  hosting?: boolean;
  query?: string;
}

// Simple in-memory cache with TTL
const cache = new Map<string, { data: IpApiResponse; expiresAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Rate limit tracking
let rateLimitRemaining = 45;
let rateLimitResetAt = 0;

const ipParamSchema = z.object({
  ip: z.string().min(1).max(45),
});

export async function lookupIp(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);

    const parsed = ipParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return next(new AppError('Invalid IP address', 400));
    }
    const { ip } = parsed.data;

    // Check cache first
    const cached = cache.get(ip);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.data);
    }

    // Check rate limit
    if (rateLimitRemaining <= 2 && Date.now() < rateLimitResetAt) {
      return next(new AppError('GeoIP lookup rate limit reached. Please try again shortly.', 429));
    }

    const url = `${IP_API_BASE}/${encodeURIComponent(ip)}?fields=${IP_API_FIELDS}`;
    const response = await fetch(url);

    // Track rate limit headers
    const rl = response.headers.get('X-Rl');
    const ttl = response.headers.get('X-Ttl');
    if (rl !== null) rateLimitRemaining = parseInt(rl, 10);
    if (ttl !== null) rateLimitResetAt = Date.now() + parseInt(ttl, 10) * 1000;

    if (!response.ok) {
      return next(new AppError('GeoIP lookup service unavailable', 502));
    }

    const data = (await response.json()) as IpApiResponse;

    if (data.status === 'fail') {
      return next(new AppError(data.message || 'GeoIP lookup failed', 400));
    }

    // Store in cache
    cache.set(ip, { data, expiresAt: Date.now() + CACHE_TTL_MS });

    // Prune stale cache entries periodically (every 100 lookups)
    if (cache.size > 500) {
      const now = Date.now();
      for (const [key, val] of cache) {
        if (val.expiresAt < now) cache.delete(key);
      }
    }

    res.json(data);
  } catch (err) {
    logger.error('[geoip] ip-api.com lookup error:', err);
    next(err);
  }
}
