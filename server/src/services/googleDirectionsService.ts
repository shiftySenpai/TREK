// server/src/services/googleDirectionsService.ts
import type { DirectionsRouteResult } from '@trek/shared';
import { getMapsKey, googleFetch } from './mapsService';

/**
 * Google Directions routing (BYO key): driving/walking single-route lookups
 * and transit itinerary search, for users who've configured their own Google
 * Maps API key (mapsService.getMapsKey). A thin, validating proxy — same
 * shape as transitService.ts's Transitous proxy, so both can sit side by
 * side in RouteCalculator.ts's dispatch.
 */

const DIRECTIONS_BASE = 'https://maps.googleapis.com/maps/api/directions/json';

const CACHE_TTL = 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; data: unknown }>();

function cacheGet(key: string): unknown | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) { cache.delete(key); return null; }
  return hit.data;
}

function cacheSet(key: string, data: unknown): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), data });
}

const COORD_RE = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/;

function isCoord(v: string): boolean {
  if (!COORD_RE.test(v)) return false;
  const [lat, lng] = v.split(',').map(Number);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function apiError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

interface GoogleDirectionsResponse {
  status: string;
  routes?: Array<{
    overview_polyline?: { points?: string };
    legs?: Array<{
      distance?: { value?: number };
      duration?: { value?: number };
      fare?: { value?: number; currency?: string };
      steps?: GoogleStep[];
    }>;
  }>;
}

interface GoogleStep {
  travel_mode?: string;
  distance?: { value?: number };
  duration?: { value?: number };
  polyline?: { points?: string };
  transit_details?: {
    line?: {
      name?: string;
      short_name?: string;
      color?: string;
      text_color?: string;
      vehicle?: { type?: string };
      agencies?: Array<{ name?: string }>;
    };
    departure_stop?: { name?: string; location?: { lat?: number; lng?: number } };
    arrival_stop?: { name?: string; location?: { lat?: number; lng?: number } };
    departure_time?: { value?: number };
    arrival_time?: { value?: number };
    num_stops?: number;
    headsign?: string;
  };
}

/** Single origin→destination route via Google Directions. Driving or walking only. */
export async function route(
  userId: number,
  origin: string,
  destination: string,
  mode: 'driving' | 'walking',
): Promise<DirectionsRouteResult> {
  if (!origin || !isCoord(origin)) throw apiError('origin must be "lat,lng"', 400);
  if (!destination || !isCoord(destination)) throw apiError('destination must be "lat,lng"', 400);

  const key = getMapsKey(userId);
  if (!key) throw apiError('No Google Maps key configured', 400);

  const cacheKey = `route:${mode}:${origin}:${destination}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached as DirectionsRouteResult;

  const params = new URLSearchParams({ origin, destination, mode, key });
  const res = await googleFetch(`${DIRECTIONS_BASE}?${params}`, 'Directions route');
  if (!res.ok) throw apiError(`Directions provider error (HTTP ${res.status})`, 502);

  const data = (await res.json()) as GoogleDirectionsResponse;

  if (data.status === 'ZERO_RESULTS') {
    const empty: DirectionsRouteResult = { distance: 0, duration: 0, polyline: null };
    cacheSet(cacheKey, empty);
    return empty;
  }
  if (data.status === 'REQUEST_DENIED') throw apiError('Google Directions request denied (check API key)', 401);
  if (data.status !== 'OK') throw apiError(`Directions provider error (${data.status})`, 502);

  const r = data.routes?.[0];
  const leg = r?.legs?.[0];
  const result: DirectionsRouteResult = {
    distance: leg?.distance?.value ?? 0,
    duration: leg?.duration?.value ?? 0,
    polyline: r?.overview_polyline?.points || null,
  };
  cacheSet(cacheKey, result);
  return result;
}
