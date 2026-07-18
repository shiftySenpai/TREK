// server/src/services/googleDirectionsService.ts
import type { DirectionsRouteResult, DirectionsTransitLeg, DirectionsTransitItinerary, DirectionsTransitResult } from '@trek/shared';
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
    fare?: { value?: number; currency?: string };
    legs?: Array<{
      distance?: { value?: number };
      duration?: { value?: number };
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

const ALLOWED_TRANSIT_MODES = new Set(['bus', 'subway', 'train', 'tram', 'rail']);

function safeHexColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const hex = v.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(hex) || /^[0-9a-fA-F]{3}$/.test(hex) ? `#${hex}` : null;
}

function mapStep(step: GoogleStep): DirectionsTransitLeg {
  const isTransit = step.travel_mode === 'TRANSIT' && !!step.transit_details;
  const td = step.transit_details;
  const depStop = td?.departure_stop;
  const arrStop = td?.arrival_stop;
  const depTime = td?.departure_time?.value != null ? new Date(td.departure_time.value * 1000).toISOString() : null;
  const arrTime = td?.arrival_time?.value != null ? new Date(td.arrival_time.value * 1000).toISOString() : null;
  return {
    mode: isTransit ? (td!.line?.vehicle?.type || 'TRANSIT') : 'WALK',
    from: { name: depStop?.name || '', lat: depStop?.location?.lat ?? 0, lng: depStop?.location?.lng ?? 0, time: depTime, scheduledTime: depTime, track: null },
    to: { name: arrStop?.name || '', lat: arrStop?.location?.lat ?? 0, lng: arrStop?.location?.lng ?? 0, time: arrTime, scheduledTime: arrTime, track: null },
    duration: step.duration?.value ?? 0,
    distance: step.distance?.value ?? null,
    headsign: td?.headsign || null,
    line: td?.line?.short_name || td?.line?.name || null,
    lineColor: isTransit ? safeHexColor(td?.line?.color) : null,
    lineTextColor: isTransit ? safeHexColor(td?.line?.text_color) : null,
    agency: td?.line?.agencies?.[0]?.name || null,
    intermediateStops: td?.num_stops ?? 0,
    geometry: step.polyline?.points || null,
    geometryPrecision: 5,
  };
}

function mapRoute(googleRoute: NonNullable<GoogleDirectionsResponse['routes']>[number]): DirectionsTransitItinerary | null {
  const leg = googleRoute.legs?.[0];
  const steps = leg?.steps;
  if (!leg || !steps || steps.length === 0) return null;

  const legs = steps.map(mapStep);
  const transitLegs = legs.filter(l => l.mode !== 'WALK');
  const firstTransit = transitLegs[0];
  const lastTransit = transitLegs[transitLegs.length - 1];
  const leadingWalk = legs[0]?.mode === 'WALK' ? legs[0].duration : 0;
  const trailingWalk = legs[legs.length - 1]?.mode === 'WALK' ? legs[legs.length - 1].duration : 0;

  const startMs = firstTransit?.from.time
    ? new Date(firstTransit.from.time).getTime() - leadingWalk * 1000
    : Date.now();
  const endMs = lastTransit?.to.time
    ? new Date(lastTransit.to.time).getTime() + trailingWalk * 1000
    : startMs + (leg.duration?.value ?? 0) * 1000;

  return {
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    duration: leg.duration?.value ?? 0,
    transfers: Math.max(0, transitLegs.length - 1),
    walkSeconds: legs.filter(l => l.mode === 'WALK').reduce((a, l) => a + l.duration, 0),
    fare: googleRoute.fare?.value != null && googleRoute.fare.currency ? { amount: googleRoute.fare.value, currency: googleRoute.fare.currency } : null,
    legs,
  };
}

/** Public-transit itinerary search via Google Directions (mode=transit, alternatives=true). */
export async function transit(
  userId: number,
  origin: string,
  destination: string,
  departureTime: string,
  transitMode?: string,
): Promise<DirectionsTransitResult> {
  if (!origin || !isCoord(origin)) throw apiError('origin must be "lat,lng"', 400);
  if (!destination || !isCoord(destination)) throw apiError('destination must be "lat,lng"', 400);
  const depMs = Date.parse(departureTime);
  if (Number.isNaN(depMs)) throw apiError('departureTime must be an ISO date-time', 400);

  const modeParts = transitMode ? transitMode.split('|').map(m => m.trim()).filter(Boolean) : [];
  if (modeParts.some(m => !ALLOWED_TRANSIT_MODES.has(m))) throw apiError('unsupported transitMode', 400);

  const key = getMapsKey(userId);
  if (!key) throw apiError('No Google Maps key configured', 400);

  const depSeconds = Math.floor(depMs / 1000);
  const cacheKey = `transit:${origin}:${destination}:${depSeconds}:${modeParts.join('|')}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached as DirectionsTransitResult;

  const params = new URLSearchParams({
    origin, destination, mode: 'transit', alternatives: 'true',
    departure_time: String(depSeconds), key,
  });
  if (modeParts.length > 0) params.set('transit_mode', modeParts.join('|'));

  const res = await googleFetch(`${DIRECTIONS_BASE}?${params}`, 'Directions transit');
  if (!res.ok) throw apiError(`Directions provider error (HTTP ${res.status})`, 502);

  const data = (await res.json()) as GoogleDirectionsResponse;

  if (data.status === 'ZERO_RESULTS') {
    const empty = { itineraries: [] };
    cacheSet(cacheKey, empty);
    return empty;
  }
  if (data.status === 'REQUEST_DENIED') throw apiError('Google Directions request denied (check API key)', 401);
  if (data.status !== 'OK') throw apiError(`Directions provider error (${data.status})`, 502);

  const itineraries = (data.routes || [])
    .map(mapRoute)
    .filter((it): it is DirectionsTransitItinerary => it !== null);
  const result = { itineraries };
  cacheSet(cacheKey, result);
  return result;
}
