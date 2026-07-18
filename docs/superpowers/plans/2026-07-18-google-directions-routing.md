# Google Directions Routing (BYO Key) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user has a Google Maps API key configured, both the day view's route toggle and the transit search panel use Google Directions (driving/walking/transit) instead of OSRM/Transitous — giving real multi-modal routing (e.g. Shinkansen vs. local trains, with fares) for trips like Tokyo → Ito. Users without a key see zero behavior change.

**Architecture:** A new server-side `googleDirectionsService.ts` (mirroring the existing `transitService.ts` pattern: validation, in-memory TTL cache, typed errors) is exposed via a new `/api/maps/directions` controller. The client dispatches to it instead of OSRM/Transitous purely based on `useAuthStore().hasMapsKey` — no new UI toggle. A new shared type file (`directions.types.ts`) is structurally identical to TREK's existing local `TransitItinerary`/`TransitLeg` shape (used in `TransitSearchPanel.tsx`), so the client needs no separate mapping function for transit results — they satisfy the same interface directly. An admin kill-switch (`directions_enabled`) mirrors the existing `places_*_enabled` pattern.

**Tech Stack:** NestJS (server), React + Vite (client), Vitest + msw (tests), Google Directions API (legacy `maps.googleapis.com/maps/api/directions/json`), existing OSRM/Transitous stack (untouched).

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-07-18-google-directions-routing-design.md`
- Google Directions API (legacy) response shape confirmed via docs fetch: `routes[].overview_polyline.points`, `routes[].legs[0].{distance,duration,fare,steps[]}`, `steps[].{travel_mode,distance,duration,polyline,transit_details}`, `transit_details.{line:{name,short_name,color,text_color,vehicle:{type},agencies[]},departure_stop,arrival_stop,departure_time,arrival_time,num_stops,headsign}`. `fare` lives on the **leg**, shape `{currency,value,text}`. `transit_mode` param accepts pipe-separated multiple values (`train|tram|subway`). Polyline encoding is always precision 5 (standard Google encoding) — decode with the app's existing `decodePolyline(str, 5)` from `client/src/components/Map/transitGeometry.ts`.

---

## Task 1: Shared Directions types

**Files:**
- Create: `shared/src/maps/directions.types.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Write the type file**

```ts
// shared/src/maps/directions.types.ts

/**
 * Google Directions API contract (BYO key). Plain interfaces, not zod —
 * mirrors transitService.ts's approach (no shared schema for /api/transit
 * either); validation happens server-side with manual checks, same as there.
 *
 * DirectionsTransitItinerary/Leg are deliberately structurally identical to
 * the local TransitItinerary/TransitLeg shape TransitSearchPanel.tsx already
 * defines for Transitous — so a Google-sourced result satisfies that same
 * client-side type with zero mapping function, only the extra `fare` field
 * (additive; Transitous itineraries simply don't have it).
 */

export interface DirectionsRouteResult {
  distance: number; // meters
  duration: number; // seconds
  /** Google-encoded polyline (standard precision 5). Decode client-side. */
  polyline: string | null;
}

export interface DirectionsTransitStop {
  name: string;
  lat: number;
  lng: number;
  time: string | null; // ISO
  scheduledTime: string | null; // ISO — Google doesn't distinguish live vs scheduled; mirrors `time`
  track: string | null; // Google Directions has no platform/track field; always null
}

export interface DirectionsTransitLeg {
  mode: string; // 'WALK' | Google's transit_details.line.vehicle.type (BUS, SUBWAY, HEAVY_RAIL, RAIL, TRAM, FERRY, ...)
  from: DirectionsTransitStop;
  to: DirectionsTransitStop;
  duration: number; // seconds
  distance: number | null; // meters
  headsign: string | null;
  line: string | null;
  lineColor: string | null;
  lineTextColor: string | null;
  agency: string | null;
  intermediateStops: number;
  /** Google-encoded polyline (standard precision 5). */
  geometry: string | null;
  geometryPrecision: number;
}

export interface DirectionsTransitItinerary {
  startTime: string; // ISO
  endTime: string; // ISO
  duration: number; // seconds
  transfers: number;
  walkSeconds: number;
  fare: { amount: number; currency: string } | null;
  legs: DirectionsTransitLeg[];
}

export interface DirectionsTransitResult {
  itineraries: DirectionsTransitItinerary[];
}

/** The kill-switch short-circuit shape, shared by both directions endpoints. */
export interface DirectionsDisabledResult {
  disabled: true;
}
```

- [ ] **Step 2: Re-export from the package root**

In `shared/src/index.ts`, find the line `export * from './maps/maps.schema';` (around line 19) and add immediately after it:

```ts
export * from './maps/directions.types';
```

- [ ] **Step 3: Typecheck the shared package**

Run: `cd /home/splunk/appDev/TREK/shared && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build the shared package**

`@trek/shared` resolves for `server`/`client` via its built `dist/` output (see `shared/package.json`'s `main`/`types` fields), not directly from `src/`. Every later task that imports the new Directions types (Tasks 3, 4, 9, 10) needs this build to be current, so rebuild now and after any further edit to `shared/src/maps/directions.types.ts` or `shared/src/index.ts`.

Run: `cd /home/splunk/appDev/TREK/shared && npm run build`
Expected: succeeds, `shared/dist/index.d.cts` / `index.d.mts` now include the new `Directions*` exports.

- [ ] **Step 5: Commit**

```bash
git add shared/src/maps/directions.types.ts shared/src/index.ts
git commit -m "feat(shared): add Google Directions type contracts"
```

---

## Task 2: Export and harden `googleFetch` in `mapsService.ts`

The legacy Directions API takes its API key as a `key=` query parameter (unlike the Places API v1 calls already in this file, which use an `X-Goog-Api-Key` header) — so it's the first caller that would put a live key into the URL `googleFetch` logs via `console.debug`. Harden the existing logger to redact it before any caller does this, then export the function so `googleDirectionsService.ts` can reuse it.

**Files:**
- Modify: `server/src/services/mapsService.ts:10-18`
- Test: `server/tests/unit/services/mapsService.googleFetch.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/unit/services/mapsService.googleFetch.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe('googleFetch', () => {
  it('MAPS-SVC-GFETCH-001: redacts a key= query param from the debug log but still sends it on the real request', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { googleFetch } = await import('../../../src/services/mapsService');
    await googleFetch('https://maps.googleapis.com/maps/api/directions/json?origin=1,2&destination=3,4&key=SECRET123', 'test call');

    const logged = debugSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).not.toContain('SECRET123');
    expect(logged).toContain('key=REDACTED');

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('key=SECRET123'); // the actual network call still carries the real key
    debugSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/splunk/appDev/TREK/server && npx vitest run tests/unit/services/mapsService.googleFetch.test.ts`
Expected: FAIL — `googleFetch` is not exported from `mapsService.ts`.

- [ ] **Step 3: Export and harden `googleFetch`**

In `server/src/services/mapsService.ts`, replace lines 10-18:

```ts
function googleFetch(endpoint: string, label: string, init?: RequestInit): Promise<Response> {
  googleApiCallCount++;
  console.debug(`[Google API] #${googleApiCallCount} ${label} → ${endpoint}`);
  const referer = process.env.APP_URL ? getAppUrl() : undefined;
  return fetch(endpoint, {
    ...init,
    headers: { ...(referer ? { Referer: referer } : {}), ...(init?.headers as Record<string, string> ?? {}) },
  });
}
```

with:

```ts
export function googleFetch(endpoint: string, label: string, init?: RequestInit): Promise<Response> {
  googleApiCallCount++;
  const loggedUrl = endpoint.replace(/([?&]key=)[^&]+/, '$1REDACTED');
  console.debug(`[Google API] #${googleApiCallCount} ${label} → ${loggedUrl}`);
  const referer = process.env.APP_URL ? getAppUrl() : undefined;
  return fetch(endpoint, {
    ...init,
    headers: { ...(referer ? { Referer: referer } : {}), ...(init?.headers as Record<string, string> ?? {}) },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/splunk/appDev/TREK/server && npx vitest run tests/unit/services/mapsService.googleFetch.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full mapsService test suite to confirm no regression**

Run: `cd /home/splunk/appDev/TREK/server && npx vitest run tests/unit/services/mapsService.test.ts`
Expected: PASS (existing Places-call tests unaffected — none of them put a key in the URL, so the redaction regex is a no-op for them).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/mapsService.ts server/tests/unit/services/mapsService.googleFetch.test.ts
git commit -m "fix(maps): export googleFetch and redact API keys from debug logs"
```

---

## Task 3: `googleDirectionsService.ts` — `route()` (driving/walking)

**Files:**
- Create: `server/src/services/googleDirectionsService.ts`
- Test: `server/tests/unit/services/googleDirectionsService.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

```ts
// server/tests/unit/services/googleDirectionsService.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/services/mapsService', () => ({
  getMapsKey: vi.fn(),
  googleFetch: vi.fn(),
}));

import { getMapsKey, googleFetch } from '../../../src/services/mapsService';
import { route } from '../../../src/services/googleDirectionsService';

const getMapsKeyMock = vi.mocked(getMapsKey);
const googleFetchMock = vi.mocked(googleFetch);

function okJson(data: unknown) {
  return { ok: true, json: async () => data } as Response;
}

beforeEach(() => {
  getMapsKeyMock.mockReset();
  googleFetchMock.mockReset();
});

describe('route', () => {
  it('GDIR-SVC-001: rejects malformed coordinates with 400 before calling upstream', async () => {
    await expect(route(1, 'x', '52.5,13.4', 'driving')).rejects.toMatchObject({ status: 400 });
    await expect(route(1, '95,13.4', '52.5,13.4', 'driving')).rejects.toMatchObject({ status: 400 });
    expect(googleFetchMock).not.toHaveBeenCalled();
  });

  it('GDIR-SVC-002: rejects when no Google Maps key is configured', async () => {
    getMapsKeyMock.mockReturnValue(null);
    await expect(route(1, '52.50,13.40', '52.51,13.41', 'driving')).rejects.toMatchObject({ status: 400 });
    expect(googleFetchMock).not.toHaveBeenCalled();
  });

  it('GDIR-SVC-003: maps a successful OK response to distance/duration/polyline', async () => {
    getMapsKeyMock.mockReturnValue('KEY123');
    googleFetchMock.mockResolvedValueOnce(okJson({
      status: 'OK',
      routes: [{
        overview_polyline: { points: 'abc123' },
        legs: [{ distance: { value: 5000 }, duration: { value: 600 } }],
      }],
    }));
    const r = await route(1, '52.50,13.40', '52.51,13.41', 'driving');
    expect(r).toEqual({ distance: 5000, duration: 600, polyline: 'abc123' });
    const [url] = googleFetchMock.mock.calls[0];
    expect(String(url)).toContain('mode=driving');
    expect(String(url)).toContain('key=KEY123');
  });

  it('GDIR-SVC-004: ZERO_RESULTS resolves to an empty route, not an error', async () => {
    getMapsKeyMock.mockReturnValue('KEY123');
    googleFetchMock.mockResolvedValueOnce(okJson({ status: 'ZERO_RESULTS' }));
    const r = await route(1, '52.50,13.40', '52.51,13.41', 'walking');
    expect(r).toEqual({ distance: 0, duration: 0, polyline: null });
  });

  it('GDIR-SVC-005: REQUEST_DENIED surfaces as a 401-style error', async () => {
    getMapsKeyMock.mockReturnValue('BADKEY');
    googleFetchMock.mockResolvedValueOnce(okJson({ status: 'REQUEST_DENIED' }));
    await expect(route(1, '52.50,13.40', '52.51,13.41', 'driving')).rejects.toMatchObject({ status: 401 });
  });

  it('GDIR-SVC-006: a non-OK HTTP response surfaces as a 502-style error', async () => {
    getMapsKeyMock.mockReturnValue('KEY123');
    googleFetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    await expect(route(1, '52.50,13.40', '52.51,13.41', 'driving')).rejects.toMatchObject({ status: 502 });
  });

  it('GDIR-SVC-007: identical requests hit the cache (single upstream call)', async () => {
    getMapsKeyMock.mockReturnValue('KEY123');
    googleFetchMock.mockResolvedValue(okJson({
      status: 'OK',
      routes: [{ overview_polyline: { points: 'xyz' }, legs: [{ distance: { value: 100 }, duration: { value: 10 } }] }],
    }));
    await route(1, '10.0000,20.0000', '10.1000,20.1000', 'driving');
    await route(1, '10.0000,20.0000', '10.1000,20.1000', 'driving');
    expect(googleFetchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/splunk/appDev/TREK/server && npx vitest run tests/unit/services/googleDirectionsService.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `route()`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/splunk/appDev/TREK/server && npx vitest run tests/unit/services/googleDirectionsService.test.ts`
Expected: PASS (all 7 `GDIR-SVC-0*` tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/services/googleDirectionsService.ts server/tests/unit/services/googleDirectionsService.test.ts
git commit -m "feat(server): add Google Directions route() for driving/walking"
```

---

## Task 4: `googleDirectionsService.ts` — `transit()`

**Files:**
- Modify: `server/src/services/googleDirectionsService.ts`
- Test: `server/tests/unit/services/googleDirectionsService.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `server/tests/unit/services/googleDirectionsService.test.ts`:

```ts
import { transit } from '../../../src/services/googleDirectionsService';

describe('transit', () => {
  const validArgs = ['52.50,13.40', '52.51,13.41', '2026-07-13T08:00:00Z'] as const;

  it('GDIR-SVC-008: rejects malformed coordinates and bad departure times with 400', async () => {
    await expect(transit(1, 'x', '52.5,13.4', '2026-07-13T08:00:00Z')).rejects.toMatchObject({ status: 400 });
    await expect(transit(1, ...([validArgs[0], validArgs[1], 'not-a-date'] as const))).rejects.toMatchObject({ status: 400 });
    expect(googleFetchMock).not.toHaveBeenCalled();
  });

  it('GDIR-SVC-009: rejects an unsupported transitMode', async () => {
    getMapsKeyMock.mockReturnValue('KEY123');
    await expect(transit(1, ...validArgs, 'airplane')).rejects.toMatchObject({ status: 400 });
    expect(googleFetchMock).not.toHaveBeenCalled();
  });

  it('GDIR-SVC-010: sends alternatives=true, unix departure_time, and pipe-joined transitMode', async () => {
    getMapsKeyMock.mockReturnValue('KEY123');
    googleFetchMock.mockResolvedValueOnce(okJson({ status: 'OK', routes: [] }));
    await transit(1, ...validArgs, 'train|tram');
    const url = String(googleFetchMock.mock.calls[0][0]);
    expect(url).toContain('mode=transit');
    expect(url).toContain('alternatives=true');
    expect(url).toContain('departure_time=1752393600'); // 2026-07-13T08:00:00Z in unix seconds
    expect(url).toContain('transit_mode=train%7Ctram');
  });

  it('GDIR-SVC-011: maps a transit+walk route into a compact itinerary with times, fare and geometry', async () => {
    getMapsKeyMock.mockReturnValue('KEY123');
    googleFetchMock.mockResolvedValueOnce(okJson({
      status: 'OK',
      routes: [{
        legs: [{
          distance: { value: 6000 },
          duration: { value: 2400 },
          fare: { value: 4720, currency: 'JPY' },
          steps: [
            {
              travel_mode: 'WALKING',
              distance: { value: 300 },
              duration: { value: 240 },
              polyline: { points: 'walkpoly' },
            },
            {
              travel_mode: 'TRANSIT',
              distance: { value: 5700 },
              duration: { value: 2160 },
              polyline: { points: 'trainpoly' },
              transit_details: {
                line: {
                  name: 'JR Tokaido Main Line', short_name: 'Local', color: '65a30d', text_color: 'ffffff',
                  vehicle: { type: 'HEAVY_RAIL' }, agencies: [{ name: 'JR East' }],
                },
                departure_stop: { name: 'Tokyo', location: { lat: 35.681, lng: 139.767 } },
                arrival_stop: { name: 'Atami', location: { lat: 35.096, lng: 139.071 } },
                departure_time: { value: 1752393000 },
                arrival_time: { value: 1752395160 },
                num_stops: 12,
                headsign: 'Atami',
              },
            },
          ],
        }],
      }],
    }));
    const r = await transit(1, ...validArgs);
    expect(r.itineraries).toHaveLength(1);
    const it = r.itineraries[0];
    expect(it.duration).toBe(2400);
    expect(it.walkSeconds).toBe(240);
    expect(it.transfers).toBe(0);
    expect(it.fare).toEqual({ amount: 4720, currency: 'JPY' });
    expect(it.legs).toHaveLength(2);
    expect(it.legs[0].mode).toBe('WALK');
    const trainLeg = it.legs[1];
    expect(trainLeg.mode).toBe('HEAVY_RAIL');
    expect(trainLeg.line).toBe('Local');
    expect(trainLeg.lineColor).toBe('#65a30d');
    expect(trainLeg.agency).toBe('JR East');
    expect(trainLeg.intermediateStops).toBe(12);
    expect(trainLeg.geometry).toBe('trainpoly');
    expect(trainLeg.geometryPrecision).toBe(5);
    expect(trainLeg.from).toMatchObject({ name: 'Tokyo', lat: 35.681, lng: 139.767 });
  });

  it('GDIR-SVC-012: ZERO_RESULTS resolves to an empty itinerary list', async () => {
    getMapsKeyMock.mockReturnValue('KEY123');
    googleFetchMock.mockResolvedValueOnce(okJson({ status: 'ZERO_RESULTS' }));
    const r = await transit(1, ...validArgs);
    expect(r.itineraries).toEqual([]);
  });

  it('GDIR-SVC-013: REQUEST_DENIED surfaces as a 401-style error', async () => {
    getMapsKeyMock.mockReturnValue('KEY123');
    googleFetchMock.mockResolvedValueOnce(okJson({ status: 'REQUEST_DENIED' }));
    await expect(transit(1, ...validArgs)).rejects.toMatchObject({ status: 401 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/splunk/appDev/TREK/server && npx vitest run tests/unit/services/googleDirectionsService.test.ts`
Expected: FAIL — `transit` is not exported.

- [ ] **Step 3: Implement `transit()`**

Add `DirectionsTransitLeg` and `DirectionsTransitItinerary` to the `@trek/shared` import at the top of `server/src/services/googleDirectionsService.ts`:

```ts
import type { DirectionsRouteResult, DirectionsTransitLeg, DirectionsTransitItinerary, DirectionsTransitResult } from '@trek/shared';
```

Then append to the file:

```ts
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
    fare: leg.fare?.value != null && leg.fare.currency ? { amount: leg.fare.value, currency: leg.fare.currency } : null,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/splunk/appDev/TREK/server && npx vitest run tests/unit/services/googleDirectionsService.test.ts`
Expected: PASS (all 13 `GDIR-SVC-0*` tests)

- [ ] **Step 5: Typecheck**

Run: `cd /home/splunk/appDev/TREK/server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/googleDirectionsService.ts server/tests/unit/services/googleDirectionsService.test.ts
git commit -m "feat(server): add Google Directions transit() itinerary search"
```

---

## Task 5: `DirectionsController` + module registration

**Files:**
- Create: `server/src/nest/maps/directions.controller.ts`
- Modify: `server/src/nest/maps/maps.module.ts`
- Test: `server/tests/unit/nest/directions.controller.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

```ts
// server/tests/unit/nest/directions.controller.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { DirectionsController } from '../../../src/nest/maps/directions.controller';
import { RateLimitService } from '../../../src/nest/auth/rate-limit.service';

vi.mock('../../../src/services/googleDirectionsService', () => ({
  route: vi.fn(),
  transit: vi.fn(),
}));
vi.mock('../../../src/services/adminService', () => ({
  getGoogleDirections: vi.fn(),
}));

import * as directionsSvc from '../../../src/services/googleDirectionsService';
import * as adminSvc from '../../../src/services/adminService';

const user = { id: 7 } as any;
const req = { ip: '127.0.0.1' } as Request;

function withError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

async function thrown(fn: () => Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try { await fn(); } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    const e = err as HttpException;
    return { status: e.getStatus(), body: e.getResponse() };
  }
  throw new Error('expected the handler to throw');
}

function makeController() {
  return new DirectionsController(new RateLimitService());
}

beforeEach(() => {
  vi.mocked(directionsSvc.route).mockReset();
  vi.mocked(directionsSvc.transit).mockReset();
  vi.mocked(adminSvc.getGoogleDirections).mockReset().mockReturnValue({ enabled: true });
});

describe('DirectionsController', () => {
  describe('GET /', () => {
    it('DIR-CTRL-001: returns the disabled envelope when the kill-switch is off', async () => {
      vi.mocked(adminSvc.getGoogleDirections).mockReturnValue({ enabled: false });
      const res = await makeController().route(user, '1,2', '3,4', 'driving', req);
      expect(res).toEqual({ disabled: true });
      expect(directionsSvc.route).not.toHaveBeenCalled();
    });

    it('DIR-CTRL-002: delegates to the service and returns its result', async () => {
      vi.mocked(directionsSvc.route).mockResolvedValue({ distance: 100, duration: 10, polyline: 'x' });
      const res = await makeController().route(user, '1,2', '3,4', 'driving', req);
      expect(res).toEqual({ distance: 100, duration: 10, polyline: 'x' });
      expect(directionsSvc.route).toHaveBeenCalledWith(7, '1,2', '3,4', 'driving');
    });

    it('DIR-CTRL-003: maps a service error to its status + message', async () => {
      vi.mocked(directionsSvc.route).mockRejectedValue(withError(401, 'bad key'));
      expect(await thrown(() => makeController().route(user, '1,2', '3,4', 'driving', req)))
        .toEqual({ status: 401, body: { error: 'bad key' } });
    });
  });

  describe('GET /transit', () => {
    it('DIR-CTRL-004: returns the disabled envelope when the kill-switch is off', async () => {
      vi.mocked(adminSvc.getGoogleDirections).mockReturnValue({ enabled: false });
      const res = await makeController().transit(user, '1,2', '3,4', '2026-01-01T00:00:00Z', undefined, req);
      expect(res).toEqual({ disabled: true });
      expect(directionsSvc.transit).not.toHaveBeenCalled();
    });

    it('DIR-CTRL-005: delegates to the service with the transitMode param', async () => {
      vi.mocked(directionsSvc.transit).mockResolvedValue({ itineraries: [] });
      const res = await makeController().transit(user, '1,2', '3,4', '2026-01-01T00:00:00Z', 'train', req);
      expect(res).toEqual({ itineraries: [] });
      expect(directionsSvc.transit).toHaveBeenCalledWith(7, '1,2', '3,4', '2026-01-01T00:00:00Z', 'train');
    });

    it('DIR-CTRL-006: maps a service error to its status + message', async () => {
      vi.mocked(directionsSvc.transit).mockRejectedValue(withError(400, 'origin must be "lat,lng"'));
      expect(await thrown(() => makeController().transit(user, 'x', '3,4', '2026-01-01T00:00:00Z', undefined, req)))
        .toEqual({ status: 400, body: { error: 'origin must be "lat,lng"' } });
    });

    it('DIR-CTRL-007: rate limits after the bucket max', async () => {
      vi.mocked(directionsSvc.transit).mockResolvedValue({ itineraries: [] });
      const c = makeController();
      for (let i = 0; i < 60; i++) await c.transit(user, '1,2', '3,4', '2026-01-01T00:00:00Z', undefined, req);
      expect(await thrown(() => c.transit(user, '1,2', '3,4', '2026-01-01T00:00:00Z', undefined, req)))
        .toMatchObject({ status: 429 });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/splunk/appDev/TREK/server && npx vitest run tests/unit/nest/directions.controller.test.ts`
Expected: FAIL — `DirectionsController` doesn't exist yet.

- [ ] **Step 3: Implement the controller**

```ts
// server/src/nest/maps/directions.controller.ts
import { Controller, Get, HttpException, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../../types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimitService } from '../auth/rate-limit.service';
import { CurrentUser } from '../auth/current-user.decorator';
import * as directions from '../../services/googleDirectionsService';
import { getGoogleDirections } from '../../services/adminService';

const RL_WINDOW = 15 * 60 * 1000;

/**
 * /api/maps/directions — Google Directions routing (BYO key), gated by both
 * the admin `directions_enabled` kill-switch and the per-user Google Maps
 * key resolved server-side in googleDirectionsService. JWT-guarded and
 * rate-limited like /api/transit — Directions billing is per-request.
 */
@Controller('api/maps/directions')
@UseGuards(JwtAuthGuard)
export class DirectionsController {
  constructor(private readonly rl: RateLimitService) {}

  private limit(bucket: string, req: Request): void {
    if (!this.rl.check(bucket, req.ip || 'unknown', 60, RL_WINDOW, Date.now())) {
      throw new HttpException({ error: 'Too many requests. Please try again later.' }, 429);
    }
  }

  private rethrow(err: unknown): never {
    const status = (err as { status?: number }).status || 502;
    const message = err instanceof Error ? err.message : 'Directions provider error';
    throw new HttpException({ error: message }, status);
  }

  @Get()
  async route(
    @CurrentUser() user: User,
    @Query('origin') origin: string | undefined,
    @Query('destination') destination: string | undefined,
    @Query('mode') mode: string | undefined,
    @Req() req: Request,
  ) {
    if (!getGoogleDirections().enabled) return { disabled: true };
    this.limit('directions_route', req);
    try {
      return await directions.route(user.id, origin || '', destination || '', (mode === 'walking' ? 'walking' : 'driving'));
    } catch (err) { this.rethrow(err); }
  }

  @Get('transit')
  async transit(
    @CurrentUser() user: User,
    @Query('origin') origin: string | undefined,
    @Query('destination') destination: string | undefined,
    @Query('time') time: string | undefined,
    @Query('transitMode') transitMode: string | undefined,
    @Req() req: Request,
  ) {
    if (!getGoogleDirections().enabled) return { disabled: true };
    this.limit('directions_transit', req);
    try {
      return await directions.transit(user.id, origin || '', destination || '', time || '', transitMode);
    } catch (err) { this.rethrow(err); }
  }
}
```

- [ ] **Step 4: Register the controller in `MapsModule`**

In `server/src/nest/maps/maps.module.ts`, replace the whole file with:

```ts
import { Module } from '@nestjs/common';
import { MapsController } from './maps.controller';
import { MapsService } from './maps.service';
import { DirectionsController } from './directions.controller';
import { RateLimitService } from '../auth/rate-limit.service';

/** Maps / geo domain (L3 leaf module). Registered in AppModule. */
@Module({
  controllers: [MapsController, DirectionsController],
  providers: [MapsService, RateLimitService],
})
export class MapsModule {}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/splunk/appDev/TREK/server && npx vitest run tests/unit/nest/directions.controller.test.ts`
Expected: PASS (all 7 `DIR-CTRL-0*` tests)

- [ ] **Step 6: Typecheck (this will fail until Task 6 adds `getGoogleDirections` — expected)**

Run: `cd /home/splunk/appDev/TREK/server && npx tsc --noEmit`
Expected: error `Module '"../../services/adminService"' has no exported member 'getGoogleDirections'`. This is expected — Task 6 adds it. Do not attempt to fix it here.

- [ ] **Step 7: Commit**

```bash
git add server/src/nest/maps/directions.controller.ts server/src/nest/maps/maps.module.ts server/tests/unit/nest/directions.controller.test.ts
git commit -m "feat(server): add /api/maps/directions controller"
```

---

## Task 6: Admin kill-switch backend (`directions_enabled`)

**Files:**
- Modify: `server/src/services/adminService.ts`
- Modify: `server/src/nest/admin/admin.service.ts`
- Modify: `server/src/nest/admin/admin.controller.ts`
- Test: `server/tests/unit/services/adminService.googleDirections.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// server/tests/unit/services/adminService.googleDirections.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../src/db/database';
import { getGoogleDirections, updateGoogleDirections } from '../../../src/services/adminService';

beforeEach(() => {
  db.prepare("DELETE FROM app_settings WHERE key = 'directions_enabled'").run();
});

describe('getGoogleDirections / updateGoogleDirections', () => {
  it('ADMIN-SVC-GDIR-001: defaults to enabled when no row exists', () => {
    expect(getGoogleDirections()).toEqual({ enabled: true });
  });

  it('ADMIN-SVC-GDIR-002: updateGoogleDirections(false) persists and getGoogleDirections reflects it', () => {
    updateGoogleDirections(false);
    expect(getGoogleDirections()).toEqual({ enabled: false });
  });

  it('ADMIN-SVC-GDIR-003: updateGoogleDirections(true) re-enables it', () => {
    updateGoogleDirections(false);
    updateGoogleDirections(true);
    expect(getGoogleDirections()).toEqual({ enabled: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/splunk/appDev/TREK/server && npx vitest run tests/unit/services/adminService.googleDirections.test.ts`
Expected: FAIL — `getGoogleDirections`/`updateGoogleDirections` not exported.

- [ ] **Step 3: Add the service functions**

In `server/src/services/adminService.ts`, immediately after the existing `// ── Places Details ──` block (after `updatePlacesDetails`, i.e. right before `// ── Collab Features ──`), add:

```ts
// ── Google Directions ────────────────────────────────────────────────────

export function getGoogleDirections() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'directions_enabled'").get() as { value: string } | undefined;
  return { enabled: row?.value !== 'false' };
}

export function updateGoogleDirections(enabled: boolean) {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('directions_enabled', ?)").run(enabled ? 'true' : 'false');
  return { enabled: !!enabled };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/splunk/appDev/TREK/server && npx vitest run tests/unit/services/adminService.googleDirections.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the Nest admin wrapper**

In `server/src/nest/admin/admin.service.ts`, find `getPlacesDetails() { return svc.getPlacesDetails(); }` / `updatePlacesDetails(enabled: boolean) { return svc.updatePlacesDetails(enabled); }` (around line 46-47's sibling block) and add immediately after:

```ts
  getGoogleDirections() { return svc.getGoogleDirections(); }
  updateGoogleDirections(enabled: boolean) { return svc.updateGoogleDirections(enabled); }
```

- [ ] **Step 6: Wire the admin controller endpoints**

In `server/src/nest/admin/admin.controller.ts`, immediately after the `places-details` block (after the closing `}` of `updatePlacesDetails`, before `@Get('collab-features')`), add:

```ts
  @Get('google-directions')
  getGoogleDirections() { return this.admin.getGoogleDirections(); }

  @Put('google-directions')
  updateGoogleDirections(@CurrentUser() user: User, @Body() body: { enabled?: unknown }, @Req() req: Request) {
    if (typeof body.enabled !== 'boolean') throw new HttpException({ error: 'enabled must be a boolean' }, 400);
    const result = this.admin.updateGoogleDirections(body.enabled);
    writeAudit({ userId: user.id, action: 'admin.google_directions', ip: getClientIp(req), details: { enabled: result.enabled } });
    return result;
  }
```

- [ ] **Step 7: Run the full server test suite for admin + directions to confirm no regressions**

Run: `cd /home/splunk/appDev/TREK/server && npx vitest run tests/unit/services/adminService.googleDirections.test.ts tests/unit/nest/directions.controller.test.ts`
Expected: PASS

- [ ] **Step 8: Typecheck**

Run: `cd /home/splunk/appDev/TREK/server && npx tsc --noEmit`
Expected: no errors (the Task 5 error from Step 6 is now resolved).

- [ ] **Step 9: Commit**

```bash
git add server/src/services/adminService.ts server/src/nest/admin/admin.service.ts server/src/nest/admin/admin.controller.ts server/tests/unit/services/adminService.googleDirections.test.ts
git commit -m "feat(admin): add directions_enabled kill-switch for Google routing"
```

---

## Task 7: i18n keys

**Files:**
- Modify: `shared/src/i18n/en/admin.ts`
- Modify: `shared/src/i18n/en/dayplan.ts`
- Modify: `shared/src/i18n/en/trip.ts`

- [ ] **Step 1: Add admin toggle copy**

In `shared/src/i18n/en/admin.ts`, immediately after the `'admin.placesDetails.subtitle'` line (around line 165), add:

```ts
  'admin.googleDirections.title': 'Google Directions Routing',
  'admin.googleDirections.subtitle':
    'Use the Google Directions API for driving routes and public transit itineraries when a user has configured their own Google Maps API key. Disable to save API quota.',
```

- [ ] **Step 2: Add the day-view toggle's aria-label**

In `shared/src/i18n/en/dayplan.ts`, immediately after `'dayplan.optimize': 'Optimize',` (around line 28), add:

```ts
  'dayplan.otherTransport': 'Other Transport',
```

- [ ] **Step 3: Add the fare row label**

In `shared/src/i18n/en/trip.ts`, immediately after `'transit.noResults': 'No connections found. Try a different time or filters.',` (around line 62), add:

```ts
  'transit.estimatedFare': 'Estimated fare',
```

- [ ] **Step 4: Run the i18n parity test (file-level only, key drift is not enforced)**

Run: `cd /home/splunk/appDev/TREK/shared && npx vitest run src/i18n/i18n-parity.spec.ts`
Expected: PASS

- [ ] **Step 5: Rebuild the shared package**

The client's `TranslationContext.tsx` loads locale strings from `@trek/shared/i18n/en`, which — like the Directions types in Task 1 — resolves via `shared/dist`, not `src/` directly. Rebuild so Task 12/13's manual verification (and any test asserting on this English copy) sees the new strings.

Run: `cd /home/splunk/appDev/TREK/shared && npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add shared/src/i18n/en/admin.ts shared/src/i18n/en/dayplan.ts shared/src/i18n/en/trip.ts
git commit -m "feat(i18n): add strings for Google Directions routing UI"
```

---

## Task 8: Admin UI toggle

**Files:**
- Modify: `client/src/api/client.ts`
- Modify: `client/src/pages/admin/useAdmin.ts`
- Modify: `client/src/pages/admin/AdminSettingsTab.tsx`

- [ ] **Step 1: Add the admin API wrapper**

In `client/src/api/client.ts`, find `updatePlacesDetails: (enabled: boolean) => ...` inside the `adminApi` object (sibling of `getPlacesAutocomplete`/`updatePlacesAutocomplete` at line 516-517) and add immediately after it:

```ts
  getGoogleDirections: () => apiClient.get('/admin/google-directions').then(r => r.data),
  updateGoogleDirections: (enabled: boolean) => apiClient.put('/admin/google-directions', { enabled }).then(r => r.data),
```

- [ ] **Step 2: Add state + fetch in `useAdmin.ts`**

In `client/src/pages/admin/useAdmin.ts`, find the line `const [placesAutocompleteEnabled, setPlacesAutocompleteEnabledState] = useState(...)` (line 44) and its paired `useEffect` (line 45), and add immediately after that pair:

```ts
  const [googleDirectionsEnabled, setGoogleDirectionsEnabledState] = useState(true)
  useEffect(() => { adminApi.getGoogleDirections().then(d => setGoogleDirectionsEnabledState(d.enabled)).catch(() => {}) }, [])
```

Then find the return statement's destructured list containing `placesAutocompleteEnabled, setPlacesAutocompleteEnabledState,` (line 371) and add `googleDirectionsEnabled, setGoogleDirectionsEnabledState,` immediately after it in that same returned object.

- [ ] **Step 3: Add the toggle row in `AdminSettingsTab.tsx`**

In `client/src/pages/admin/AdminSettingsTab.tsx`, find the destructured props list that includes `placesAutocompleteEnabled, setPlacesAutocompleteEnabledState,` (line 20) and add `googleDirectionsEnabled, setGoogleDirectionsEnabledState,` immediately after it.

Then, immediately after the "Place Details Toggle" block's closing `</div>` (the block starting at line 369 in the original file, ending before whatever section follows it), add:

```tsx
          {/* Google Directions Toggle */}
          <div className="flex items-center justify-between gap-4 py-3 border-t border-slate-100">
            <div>
              <p className="text-sm font-medium text-slate-700">{t('admin.googleDirections.title')}</p>
              <p className="text-xs text-slate-400 mt-0.5">{t('admin.googleDirections.subtitle')}</p>
            </div>
            <button
              onClick={async () => {
                const next = !googleDirectionsEnabled
                setGoogleDirectionsEnabledState(next)
                try { await adminApi.updateGoogleDirections(next) } catch { setGoogleDirectionsEnabledState(!next) }
              }}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${googleDirectionsEnabled ? 'bg-content' : 'bg-edge'}`}
            >
              <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-200" style={{ transform: googleDirectionsEnabled ? 'translateX(20px)' : 'translateX(0)' }} />
            </button>
          </div>
```

- [ ] **Step 4: Typecheck**

Run: `cd /home/splunk/appDev/TREK/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manually verify in the running app**

Run: `cd /home/splunk/appDev/TREK && npm run dev` (the repo-root script that builds `shared` then runs `server`+`client` dev servers concurrently), log in as an admin, open Admin Settings, and confirm the new "Google Directions Routing" toggle appears below "Place Details" and persists its state across a page reload.

- [ ] **Step 6: Commit**

```bash
git add client/src/api/client.ts client/src/pages/admin/useAdmin.ts client/src/pages/admin/AdminSettingsTab.tsx
git commit -m "feat(admin): add Google Directions Routing toggle to admin settings UI"
```

---

## Task 9: Client `directionsApi`

**Files:**
- Modify: `client/src/api/client.ts`

- [ ] **Step 1: Add the wrapper**

In `client/src/api/client.ts`, immediately after the `transitApi` block (after its closing `}` around line 868), add:

```ts
// Google Directions routing (BYO key) — driving/walking routes and transit
// itinerary search, mirroring transitApi's shape. The client dispatches to
// this instead of OSRM/Transitous purely based on useAuthStore().hasMapsKey.
export const directionsApi = {
  route: (origin: string, destination: string, mode: 'driving' | 'walking') =>
    apiClient.get('/maps/directions', { params: { origin, destination, mode } }).then(r => r.data),
  transit: (origin: string, destination: string, time: string, transitMode?: string) =>
    apiClient.get('/maps/directions/transit', { params: { origin, destination, time, transitMode } }).then(r => r.data),
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/splunk/appDev/TREK/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/api/client.ts
git commit -m "feat(client): add directionsApi wrapper for Google Directions routing"
```

---

## Task 10: `RouteCalculator.ts` — Google-backed routes + dispatch

Only `driving`/`walking`/the new `transit` profile dispatch to Google when `hasMapsKey` is true. `cycling` (not exposed in any UI toggle today) is untouched and always stays on OSRM. The simple `calculateRoute`/`calculateSegments` functions (used by an unrelated, hardcoded-`'walking'` legacy call site) are also untouched — only `calculateRouteWithLegs`, the function every current profile-toggle call site actually uses, gets the dispatch.

**Files:**
- Modify: `client/src/components/Map/RouteCalculator.ts`
- Modify: `client/src/types.ts`
- Test: `client/src/components/Map/RouteCalculator.test.ts`

- [ ] **Step 1: Widen the `RouteWithLegs`-consuming profile type in `types.ts`**

No change needed to `types.ts` — `RouteWithLegs`/`RouteSegment`/`Waypoint` are already profile-agnostic (they don't encode the profile at all). Skip this step; it's called out only to confirm no type change is needed here.

- [ ] **Step 2: Write the failing tests**

Add to `client/src/components/Map/RouteCalculator.test.ts`, after the existing `calculateRoute` describe block (before `calculateSegments`):

```ts
import { directionsApi } from '../../api/client'
import { useAuthStore } from '../../store/authStore'
import { calculateRouteWithLegs } from './RouteCalculator'

vi.mock('../../api/client', () => ({
  directionsApi: { route: vi.fn(), transit: vi.fn() },
}))

describe('calculateRouteWithLegs (Google dispatch)', () => {
  beforeEach(() => {
    vi.mocked(directionsApi.route).mockReset()
    vi.mocked(directionsApi.transit).mockReset()
    useAuthStore.setState({ hasMapsKey: false } as any)
  })

  it('FE-COMP-ROUTECALCULATOR-026: uses OSRM (not Google) when hasMapsKey is false', async () => {
    server.use(
      http.get(`${OSRM_BASE}/driving/:coords`, () => HttpResponse.json(buildOsrmRouteResponse()))
    )
    await calculateRouteWithLegs([wp1, wp2], { profile: 'driving' })
    expect(directionsApi.route).not.toHaveBeenCalled()
  })

  it('FE-COMP-ROUTECALCULATOR-027: dispatches driving/walking to Google when hasMapsKey is true', async () => {
    useAuthStore.setState({ hasMapsKey: true } as any)
    vi.mocked(directionsApi.route).mockResolvedValue({ distance: 5000, duration: 600, polyline: null })
    const r = await calculateRouteWithLegs([wp1, wp2], { profile: 'driving' })
    expect(directionsApi.route).toHaveBeenCalledWith(`${wp1.lat},${wp1.lng}`, `${wp2.lat},${wp2.lng}`, 'driving')
    expect(r.distance).toBe(5000)
    expect(r.duration).toBe(600)
    expect(r.legs).toHaveLength(1)
  })

  it('FE-COMP-ROUTECALCULATOR-028: decodes the returned polyline into coordinates', async () => {
    useAuthStore.setState({ hasMapsKey: true } as any)
    // Encoded polyline for [[38.5,-120.2],[40.7,-120.95]] at precision 5 (Google's standard example).
    vi.mocked(directionsApi.route).mockResolvedValue({ distance: 1000, duration: 100, polyline: '_p~iF~ps|U_ulLnnqC' })
    const r = await calculateRouteWithLegs([wp1, wp2], { profile: 'driving' })
    expect(r.coordinates.length).toBeGreaterThan(0)
    expect(r.coordinates[0][0]).toBeCloseTo(38.5, 3)
  })

  it('FE-COMP-ROUTECALCULATOR-029: cycling always stays on OSRM regardless of hasMapsKey', async () => {
    useAuthStore.setState({ hasMapsKey: true } as any)
    server.use(
      http.get(`${OSRM_PROFILE_BASE_URL}`, () => HttpResponse.json(buildOsrmRouteResponse()))
    )
    await calculateRouteWithLegs([wp1, wp2], { profile: 'cycling' })
    expect(directionsApi.route).not.toHaveBeenCalled()
  })

  it('FE-COMP-ROUTECALCULATOR-030: transit profile always calls the Google transit endpoint, never OSRM', async () => {
    useAuthStore.setState({ hasMapsKey: true } as any)
    vi.mocked(directionsApi.transit).mockResolvedValue({
      itineraries: [{
        startTime: '2026-07-13T08:00:00Z', endTime: '2026-07-13T08:40:00Z', duration: 2400,
        transfers: 0, walkSeconds: 0, fare: { amount: 4720, currency: 'JPY' },
        legs: [{
          mode: 'HEAVY_RAIL', from: { name: 'A', lat: wp1.lat, lng: wp1.lng, time: null, scheduledTime: null, track: null },
          to: { name: 'B', lat: wp2.lat, lng: wp2.lng, time: null, scheduledTime: null, track: null },
          duration: 2400, distance: 5000, headsign: null, line: 'Local', lineColor: null, lineTextColor: null,
          agency: null, intermediateStops: 3, geometry: null, geometryPrecision: 5,
        }],
      }],
    })
    const r = await calculateRouteWithLegs([wp1, wp2], { profile: 'transit' })
    expect(directionsApi.transit).toHaveBeenCalled()
    expect(r.duration).toBe(2400)
    expect(r.legs[0].durationText).toBeTruthy()
  })

  it('FE-COMP-ROUTECALCULATOR-031: transit profile passes the given departureTime through', async () => {
    useAuthStore.setState({ hasMapsKey: true } as any)
    vi.mocked(directionsApi.transit).mockResolvedValue({ itineraries: [{ startTime: 'x', endTime: 'y', duration: 1, transfers: 0, walkSeconds: 0, fare: null, legs: [] }] })
    await calculateRouteWithLegs([wp1, wp2], { profile: 'transit', departureTime: '2026-07-13T09:00:00Z' })
    expect(directionsApi.transit).toHaveBeenCalledWith(`${wp1.lat},${wp1.lng}`, `${wp2.lat},${wp2.lng}`, '2026-07-13T09:00:00Z', undefined)
  })

  it('FE-COMP-ROUTECALCULATOR-032: transit profile throws when Google returns no itinerary', async () => {
    useAuthStore.setState({ hasMapsKey: true } as any)
    vi.mocked(directionsApi.transit).mockResolvedValue({ itineraries: [] })
    await expect(calculateRouteWithLegs([wp1, wp2], { profile: 'transit' })).rejects.toThrow('No route found')
  })
})
```

Add this constant near the top of the test file, alongside the existing `OSRM_BASE` constant:

```ts
const OSRM_PROFILE_BASE_URL = 'https://routing.openstreetmap.de/routed-bike/route/v1/bike/:coords'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/splunk/appDev/TREK/client && npx vitest run src/components/Map/RouteCalculator.test.ts`
Expected: FAIL — `calculateRouteWithLegs` doesn't dispatch to Google yet, `directionsApi` mock unused, `profile: 'transit'` not a valid type.

- [ ] **Step 3: Implement the dispatch and Google-backed helpers**

In `client/src/components/Map/RouteCalculator.ts`, add these imports at the top (after the existing `formatDistance` import):

```ts
import { decodePolyline } from './transitGeometry'
import { directionsApi } from '../../api/client'
import { useAuthStore } from '../../store/authStore'
```

Add these two new functions right before `calculateRouteWithLegs`'s existing definition (which currently starts at line 234):

```ts
/** One Google Directions call per consecutive waypoint pair (driving/walking); stitched into one RouteWithLegs. */
async function calculateGoogleRouteWithLegs(
  waypoints: Waypoint[],
  profile: 'driving' | 'walking',
): Promise<RouteWithLegs> {
  const coordinates: [number, number][] = []
  const legs: RouteSegment[] = []
  let distance = 0
  let duration = 0
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]
    const b = waypoints[i + 1]
    const r = await directionsApi.route(`${a.lat},${a.lng}`, `${b.lat},${b.lng}`, profile)
    const legCoords = r.polyline ? decodePolyline(r.polyline, 5) : []
    coordinates.push(...(i === 0 ? legCoords : legCoords.slice(1)))
    distance += r.distance
    duration += r.duration
    const mid: [number, number] = [(a.lat + b.lat) / 2, (a.lng + b.lng) / 2]
    const durationText = formatDuration(r.duration)
    legs.push({
      mid, from: [a.lat, a.lng], to: [b.lat, b.lng],
      distance: r.distance, duration: r.duration,
      walkingText: durationText, drivingText: durationText,
      distanceText: formatRouteDistance(r.distance), durationText,
    })
  }
  return { coordinates, distance, duration, legs }
}

/** One Google transit itinerary lookup per consecutive waypoint pair, taking each pair's top-ranked result. */
async function calculateTransitRouteWithLegs(
  waypoints: Waypoint[],
  departureTime: string | undefined,
): Promise<RouteWithLegs> {
  const coordinates: [number, number][] = []
  const legs: RouteSegment[] = []
  let distance = 0
  let duration = 0
  const depTime = departureTime || new Date().toISOString()
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]
    const b = waypoints[i + 1]
    const r = await directionsApi.transit(`${a.lat},${a.lng}`, `${b.lat},${b.lng}`, depTime)
    const itinerary = r.itineraries[0]
    if (!itinerary) throw new Error('No route found')
    for (const leg of itinerary.legs) {
      if (leg.geometry) coordinates.push(...decodePolyline(leg.geometry, leg.geometryPrecision))
    }
    const legDistance = itinerary.legs.reduce((s, l) => s + (l.distance ?? 0), 0)
    distance += legDistance
    duration += itinerary.duration
    const mid: [number, number] = [(a.lat + b.lat) / 2, (a.lng + b.lng) / 2]
    const durationText = formatDuration(itinerary.duration)
    legs.push({
      mid, from: [a.lat, a.lng], to: [b.lat, b.lng],
      distance: legDistance, duration: itinerary.duration,
      walkingText: durationText, drivingText: durationText,
      distanceText: formatRouteDistance(legDistance), durationText,
    })
  }
  return { coordinates, distance, duration, legs }
}
```

Then replace the existing `calculateRouteWithLegs` function signature and its first few lines (currently):

```ts
export async function calculateRouteWithLegs(
  waypoints: Waypoint[],
  { signal, profile = 'driving' }: { signal?: AbortSignal; profile?: 'driving' | 'walking' | 'cycling' } = {}
): Promise<RouteWithLegs> {
  if (!waypoints || waypoints.length < 2) {
    return { coordinates: [], distance: 0, duration: 0, legs: [] }
  }

  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(';')
```

with:

```ts
export async function calculateRouteWithLegs(
  waypoints: Waypoint[],
  { signal, profile = 'driving', departureTime }: { signal?: AbortSignal; profile?: 'driving' | 'walking' | 'cycling' | 'transit'; departureTime?: string } = {}
): Promise<RouteWithLegs> {
  if (!waypoints || waypoints.length < 2) {
    return { coordinates: [], distance: 0, duration: 0, legs: [] }
  }

  if (profile === 'transit') {
    return calculateTransitRouteWithLegs(waypoints, departureTime)
  }

  if ((profile === 'driving' || profile === 'walking') && useAuthStore.getState().hasMapsKey) {
    return calculateGoogleRouteWithLegs(waypoints, profile)
  }

  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(';')
```

Leave everything below that line (the existing OSRM fetch/mapping body) unchanged — but note it references `OSRM_PROFILE_BASE[profile]` where `profile` is now typed to include `'transit'`; since we return early for `'transit'` above, `profile` at that point in the function is narrowed to `'driving' | 'walking' | 'cycling'` and `OSRM_PROFILE_BASE[profile]` still typechecks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/splunk/appDev/TREK/client && npx vitest run src/components/Map/RouteCalculator.test.ts`
Expected: PASS (all tests, including the new `FE-COMP-ROUTECALCULATOR-026` through `-032`)

- [ ] **Step 5: Typecheck**

Run: `cd /home/splunk/appDev/TREK/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Map/RouteCalculator.ts client/src/components/Map/RouteCalculator.test.ts
git commit -m "feat(client): dispatch route calculation to Google Directions when a maps key is present"
```

---

## Task 11: Widen `profile` type through the call chain

**Files:**
- Modify: `client/src/hooks/useRouteCalculation.ts:19`
- Modify: `client/src/pages/tripPlanner/useTripPlanner.ts:205`

- [ ] **Step 1: Widen `useRouteCalculation`'s profile param**

In `client/src/hooks/useRouteCalculation.ts`, line 19, replace:

```ts
export function useRouteCalculation(tripStore: TripStoreState, selectedDayId: number | null, enabled: boolean = true, profile: 'driving' | 'walking' | 'cycling' = 'driving', accommodations: Accommodation[] = NO_ACCOMMODATIONS) {
```

with:

```ts
export function useRouteCalculation(tripStore: TripStoreState, selectedDayId: number | null, enabled: boolean = true, profile: 'driving' | 'walking' | 'cycling' | 'transit' = 'driving', accommodations: Accommodation[] = NO_ACCOMMODATIONS) {
```

- [ ] **Step 2: Widen `useTripPlanner`'s `routeProfile` state**

In `client/src/pages/tripPlanner/useTripPlanner.ts`, line 205, replace:

```ts
  const [routeProfile, setRouteProfile] = useState<'driving' | 'walking'>('driving')
```

with:

```ts
  const [routeProfile, setRouteProfile] = useState<'driving' | 'walking' | 'transit'>('driving')
```

- [ ] **Step 3: Typecheck**

Run: `cd /home/splunk/appDev/TREK/client && npx tsc --noEmit`
Expected: error in `DayPlanSidebar.tsx` — its `routeProfile`/`onSetRouteProfile` prop types don't yet accept `'transit'`. This is expected; Task 12 fixes it. Do not attempt to fix it here.

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useRouteCalculation.ts client/src/pages/tripPlanner/useTripPlanner.ts
git commit -m "feat(client): widen route profile type to include transit"
```

---

## Task 12: `DayPlanSidebar.tsx` — Other Transport button

**Files:**
- Modify: `client/src/components/Planner/DayPlanSidebar.tsx`
- Test: `client/src/components/Planner/DayPlanSidebar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `client/src/components/Planner/DayPlanSidebar.test.tsx`, near the end of the `describe('DayPlanSidebar', ...)` block:

```ts
  it('FE-PLANNER-DAYPLAN-104: the Other Transport button is absent without a Google Maps key', () => {
    const day = buildDay({ id: 10, date: '2025-06-01', title: 'Day 1' })
    render(<DayPlanSidebar {...makeDefaultProps({ days: [day], selectedDayId: null, showRouteToolsWhenExpanded: true })} />)
    expect(screen.queryByLabelText('Other Transport')).not.toBeInTheDocument()
  })

  it('FE-PLANNER-DAYPLAN-105: the Other Transport button appears and is selectable with a Google Maps key', async () => {
    const user = userEvent.setup()
    seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true, hasMapsKey: true })
    const onSetRouteProfile = vi.fn()
    const day = buildDay({ id: 10, date: '2025-06-01', title: 'Day 1' })
    render(<DayPlanSidebar {...makeDefaultProps({
      days: [day], selectedDayId: null, showRouteToolsWhenExpanded: true, onSetRouteProfile,
    })} />)
    const btn = screen.getByLabelText('Other Transport')
    await user.click(btn)
    expect(onSetRouteProfile).toHaveBeenCalledWith('transit')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/splunk/appDev/TREK/client && npx vitest run src/components/Planner/DayPlanSidebar.test.tsx -t "Other Transport"`
Expected: FAIL — no such button exists yet.

- [ ] **Step 3: Import `Train` icon and `useAuthStore`**

In `client/src/components/Planner/DayPlanSidebar.tsx`, line 7, replace:

```ts
import { ChevronDown, ChevronRight, ChevronUp, Navigation, RotateCcw, ExternalLink, Clock, Pencil, GripVertical, Ticket, Plus, FileText, Trash2, Car, Lock, Hotel, Footprints, Route as RouteIcon, Bookmark, TramFront } from 'lucide-react'
```

with:

```ts
import { ChevronDown, ChevronRight, ChevronUp, Navigation, RotateCcw, ExternalLink, Clock, Pencil, GripVertical, Ticket, Plus, FileText, Trash2, Car, Lock, Hotel, Footprints, Route as RouteIcon, Bookmark, TramFront, Train } from 'lucide-react'
```

Then, after the existing `import { useTripStore } from '../../store/tripStore'` line (line 18), add:

```ts
import { useAuthStore } from '../../store/authStore'
```

- [ ] **Step 4: Widen the `routeProfile`/`onSetRouteProfile` prop types**

Lines 76 and 78, replace:

```ts
  routeProfile?: 'driving' | 'walking'
```
```ts
  onSetRouteProfile?: (profile: 'driving' | 'walking') => void
```

with:

```ts
  routeProfile?: 'driving' | 'walking' | 'transit'
```
```ts
  onSetRouteProfile?: (profile: 'driving' | 'walking' | 'transit') => void
```

- [ ] **Step 5: Read `hasMapsKey` in the component body**

Find the component's function signature / hook calls near the top of the component (where `useTripStore`, `useCanDo`, etc. are called — same region as the existing `useAddonStore`/`useSaveToCollectionStore` calls) and add:

```ts
  const hasMapsKey = useAuthStore(s => s.hasMapsKey)
```

- [ ] **Step 6: Carry each run's leading place_time through `planDay`**

In `planDay` (around line 436), widen the local run-item shape to also carry an optional departure time, sourced from the place's `place_time`. Replace:

```ts
      const runs: { id: number; lat: number; lng: number }[][] = []
      let cur: { id: number; lat: number; lng: number }[] = []
```

with:

```ts
      const runs: { id: number; lat: number; lng: number; time: string | null }[][] = []
      let cur: { id: number; lat: number; lng: number; time: string | null }[] = []
```

And replace the line that pushes a place into `cur` (around line 445):

```ts
          cur.push({ id: it.data.id, lat: it.data.place.lat, lng: it.data.place.lng })
```

with:

```ts
          cur.push({ id: it.data.id, lat: it.data.place.lat, lng: it.data.place.lng, time: it.data.place.place_time ?? null })
```

The other two places that push into `cur` in this function (the transport `from`/`to` push at lines 453/457, and the id-reattachment at line 461) have no associated place, so give them `time: null`:

```ts
            if (from) cur.push({ id: r.id, lat: from.lat, lng: from.lng, time: null })
            if (cur.length >= 2 && curHasPlace) runs.push(cur)
            cur = []
            curHasPlace = false
            if (to) cur.push({ id: r.id, lat: to.lat, lng: to.lng, time: null })
          } else if (cur.length > 0) {
            // No location: ignore for routing, but attribute the through-leg to the
            // booking so its distance/duration shows under it (purely cosmetic).
            cur[cur.length - 1] = { ...cur[cur.length - 1], id: r.id }
```

(This last block is unchanged — `{ ...cur[cur.length - 1], id: r.id }` already spreads the existing `time` field through.)

- [ ] **Step 7: Thread departure time into the two `calculateRouteWithLegs` call sites**

Replace the run-loop call (around line 516):

```ts
            const r = await calculateRouteWithLegs(run.map(p => ({ lat: p.lat, lng: p.lng })), { signal: controller.signal, profile: routeProfile })
```

with:

```ts
            const departureTime = routeProfile === 'transit' ? (run[0]?.time ?? undefined) : undefined
            const r = await calculateRouteWithLegs(run.map(p => ({ lat: p.lat, lng: p.lng })), { signal: controller.signal, profile: routeProfile, departureTime })
```

The `legBetween` helper (line 504-509, used for hotel bookend legs) has no associated place — leave it as-is; it will default to "now" inside `calculateTransitRouteWithLegs` when `routeProfile === 'transit'`, which is correct since a hotel isn't a `Place` with a `place_time`.

- [ ] **Step 8: Add the third toggle button**

Replace the toggle block (lines 2394-2413):

```tsx
                        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-faint)', flexShrink: 0 }}>
                          {(['driving', 'walking'] as const).map(p => {
                            const ModeIcon = p === 'driving' ? Car : Footprints
                            const active = routeProfile === p
                            return (
                              <button
                                key={p}
                                onClick={() => onSetRouteProfile?.(p)}
                                aria-label={p === 'driving' ? 'Driving' : 'Walking'}
                                className={active ? 'bg-accent text-accent-text' : 'bg-transparent text-content-secondary'}
                                style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  padding: '6px 10px', border: 'none', cursor: 'pointer',
                                }}
                              >
                                <ModeIcon size={13} strokeWidth={2} />
                              </button>
                            )
                          })}
                        </div>
```

with:

```tsx
                        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-faint)', flexShrink: 0 }}>
                          {(hasMapsKey ? (['driving', 'walking', 'transit'] as const) : (['driving', 'walking'] as const)).map(p => {
                            const ModeIcon = p === 'driving' ? Car : p === 'walking' ? Footprints : Train
                            const active = routeProfile === p
                            return (
                              <button
                                key={p}
                                onClick={() => onSetRouteProfile?.(p)}
                                aria-label={p === 'driving' ? 'Driving' : p === 'walking' ? 'Walking' : t('dayplan.otherTransport')}
                                className={active ? 'bg-accent text-accent-text' : 'bg-transparent text-content-secondary'}
                                style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  padding: '6px 10px', border: 'none', cursor: 'pointer',
                                }}
                              >
                                <ModeIcon size={13} strokeWidth={2} />
                              </button>
                            )
                          })}
                        </div>
```

(`t` is already available in this component — it's used throughout, e.g. `t('dayplan.optimize')` two elements up.)

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd /home/splunk/appDev/TREK/client && npx vitest run src/components/Planner/DayPlanSidebar.test.tsx`
Expected: PASS (all tests, including the new `FE-PLANNER-DAYPLAN-104`/`105`, and no regressions in the existing 103 tests)

- [ ] **Step 10: Typecheck**

Run: `cd /home/splunk/appDev/TREK/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 11: Manually verify in the running app**

Run: `cd /home/splunk/appDev/TREK && npm run dev` (the repo-root dev script). With no Google Maps key configured for your user, open a trip's day view and confirm the route toggle still shows only Drive/Walk. Add a Google Maps API key in Settings, reload, and confirm a third train-icon button appears, is clickable, and its `aria-label` reads "Other Transport" (hover/inspect).

- [ ] **Step 12: Commit**

```bash
git add client/src/components/Planner/DayPlanSidebar.tsx client/src/components/Planner/DayPlanSidebar.test.tsx
git commit -m "feat(planner): add Other Transport route option, gated on a Google Maps key"
```

---

## Task 13: `TransitSearchPanel.tsx` — Google path + fare display

**Files:**
- Modify: `client/src/components/Planner/TransitSearchPanel.tsx`
- Test: `client/src/components/Planner/TransitSearchPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `client/src/components/Planner/TransitSearchPanel.test.tsx`, replace the existing mock setup (lines 11-18):

```ts
const { transitApiMock } = vi.hoisted(() => ({
  transitApiMock: { geocode: vi.fn(), plan: vi.fn() },
}))

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal() as object
  return { ...actual, transitApi: transitApiMock }
})
```

with:

```ts
const { transitApiMock, directionsApiMock } = vi.hoisted(() => ({
  transitApiMock: { geocode: vi.fn(), plan: vi.fn() },
  directionsApiMock: { route: vi.fn(), transit: vi.fn() },
}))

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal() as object
  return { ...actual, transitApi: transitApiMock, directionsApi: directionsApiMock }
})
```

(A module can only be mocked once per file — this merges the new `directionsApi` mock into the existing `vi.mock('../../api/client', ...)` call rather than adding a second one.)

Add these tests inside the `describe('TransitSearchPanel', ...)` block:

```ts
  it('FE-PLANNER-TRANSIT-007: with a Google Maps key, searching calls directionsApi.transit instead of transitApi.plan', async () => {
    const user = userEvent.setup()
    seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true, hasMapsKey: true })
    directionsApiMock.transit.mockResolvedValueOnce({
      itineraries: [{
        startTime: '2025-06-01T06:30:00Z', endTime: '2025-06-01T07:00:00Z', duration: 1800,
        transfers: 0, walkSeconds: 0, fare: { amount: 4720, currency: 'JPY' },
        legs: [{
          mode: 'HEAVY_RAIL', from: { name: 'Fernsehturm', lat: 52.5208, lng: 13.4094, time: null, scheduledTime: null, track: null },
          to: { name: 'Zoologischer Garten', lat: 52.507, lng: 13.332, time: null, scheduledTime: null, track: null },
          duration: 1800, distance: 5000, headsign: null, line: 'Local', lineColor: null, lineTextColor: null,
          agency: null, intermediateStops: 3, geometry: null, geometryPrecision: 5,
        }],
      }],
    })
    render(<TransitSearchPanel {...makeProps()} />)
    await pickFromAndTo(user)
    await user.click(screen.getByRole('button', { name: /^Search$/ }))
    expect(await screen.findByText(/08:30 – 09:00/)).toBeInTheDocument()
    expect(transitApiMock.plan).not.toHaveBeenCalled()
    expect(directionsApiMock.transit).toHaveBeenCalled()
  })

  it('FE-PLANNER-TRANSIT-008: a Google-sourced itinerary with a fare shows the fare row when expanded', async () => {
    const user = userEvent.setup()
    seedStore(useAuthStore, { user: buildUser(), isAuthenticated: true, hasMapsKey: true })
    directionsApiMock.transit.mockResolvedValueOnce({
      itineraries: [{
        startTime: '2025-06-01T06:30:00Z', endTime: '2025-06-01T07:00:00Z', duration: 1800,
        transfers: 0, walkSeconds: 0, fare: { amount: 4720, currency: 'JPY' },
        legs: [{
          mode: 'HEAVY_RAIL', from: { name: 'Fernsehturm', lat: 52.5208, lng: 13.4094, time: null, scheduledTime: null, track: null },
          to: { name: 'Zoologischer Garten', lat: 52.507, lng: 13.332, time: null, scheduledTime: null, track: null },
          duration: 1800, distance: 5000, headsign: null, line: 'Local', lineColor: null, lineTextColor: null,
          agency: null, intermediateStops: 3, geometry: null, geometryPrecision: 5,
        }],
      }],
    })
    render(<TransitSearchPanel {...makeProps()} />)
    await pickFromAndTo(user)
    await user.click(screen.getByRole('button', { name: /^Search$/ }))
    await user.click(await screen.findByText(/08:30 – 09:00/))
    expect(await screen.findByText('Estimated fare')).toBeInTheDocument()
    expect(screen.getByText(/4720|4,720/)).toBeInTheDocument()
  })

  it('FE-PLANNER-TRANSIT-009: without a Google Maps key, searching still calls transitApi.plan (unchanged)', async () => {
    const user = userEvent.setup()
    transitApiMock.plan.mockResolvedValueOnce({ itineraries: [ITINERARY] })
    render(<TransitSearchPanel {...makeProps()} />)
    await pickFromAndTo(user)
    await user.click(screen.getByRole('button', { name: /^Search$/ }))
    expect(await screen.findByText(/08:30 – 09:00/)).toBeInTheDocument()
    expect(directionsApiMock.transit).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/splunk/appDev/TREK/client && npx vitest run src/components/Planner/TransitSearchPanel.test.tsx`
Expected: FAIL — `directionsApi` mock unused by the component, no fare row rendered.

- [ ] **Step 3: Import `useAuthStore` and `directionsApi`, widen the local `TransitItinerary` type**

In `client/src/components/Planner/TransitSearchPanel.tsx`, add to the imports (after `import { transitApi } from '../../api/client'`):

```ts
import { directionsApi } from '../../api/client'
import { useAuthStore } from '../../store/authStore'
```

Widen the local `TransitItinerary` interface (around line 31-33) to add the optional `fare` field:

```ts
export interface TransitItinerary {
  startTime: string; endTime: string; duration: number; transfers: number; walkSeconds: number; legs: TransitLeg[]
  fare?: { amount: number; currency: string } | null
}
```

- [ ] **Step 4: Read `hasMapsKey` and map the transit_mode chips to Google's param**

Near the top of the `TransitSearchPanel` component function body (alongside the existing `is12h`/`isMobile` consts), add:

```ts
  const hasMapsKey = useAuthStore(s => s.hasMapsKey)
```

Add this mapping table near `MODE_GROUPS` (module scope, right after it):

```ts
// TREK's finer mode groups → Google's transit_mode values (pipe-joined; ferry/cable have no Google equivalent).
const GOOGLE_TRANSIT_MODE: Partial<Record<string, string>> = {
  rail: 'train', subway: 'subway', tram: 'tram', bus: 'bus',
}
```

- [ ] **Step 5: Branch `search()` on `hasMapsKey`**

Replace the body of `search` (currently):

```ts
  const search = async () => {
    if (!from || !to || !day.date) return
    setLoading(true)
    setItineraries(null)
    setExpandedIdx(null)
    try {
      const tzFrom = tzAt(from.lat, from.lng)
      const timeIso = localToUtcIso(day.date, time, tzFrom)
      const allModes = activeModes.size === MODE_GROUPS.length
      const modes = allModes ? undefined : MODE_GROUPS.filter(m => activeModes.has(m.key)).map(m => m.modes).join(',')
      const d = await transitApi.plan({ from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}`, time: timeIso, arriveBy, modes })
```

with:

```ts
  const search = async () => {
    if (!from || !to || !day.date) return
    setLoading(true)
    setItineraries(null)
    setExpandedIdx(null)
    try {
      const tzFrom = tzAt(from.lat, from.lng)
      const timeIso = localToUtcIso(day.date, time, tzFrom)
      const allModes = activeModes.size === MODE_GROUPS.length
      let d: { itineraries: TransitItinerary[] }
      if (hasMapsKey) {
        const transitMode = allModes ? undefined : Array.from(activeModes).map(k => GOOGLE_TRANSIT_MODE[k]).filter((v): v is string => !!v).join('|') || undefined
        d = await directionsApi.transit(`${from.lat},${from.lng}`, `${to.lat},${to.lng}`, timeIso, transitMode)
      } else {
        const modes = allModes ? undefined : MODE_GROUPS.filter(m => activeModes.has(m.key)).map(m => m.modes).join(',')
        d = await transitApi.plan({ from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}`, time: timeIso, arriveBy, modes })
      }
```

`arriveBy` is intentionally not forwarded on the Google path — Google's Directions API takes either a departure or arrival time but this panel's "Arrive by" toggle only needs to affect the free-text `timeIso` computation identically either way for now, matching how the rest of `search()` already treats `d.itineraries` uniformly below this point (no further changes needed there — leave the rest of `search()`, including the `cleanStop` mapping and `setItineraries(cleaned)` call, exactly as-is).

- [ ] **Step 6: Add the fare row to `ItineraryCard`**

In the `ItineraryCard` component, find the `<button onClick={onAdd} ...>` element (the "Add to day" button, near the end of the `expanded &&` block) and add a fare row immediately before it:

```tsx
          {it.fare != null && (
            <div className="bg-surface-tertiary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 8, padding: '8px 12px', marginTop: 10 }}>
              <span className="text-content-muted" style={{ fontSize: 'calc(11px * var(--fs-scale-caption, 1))', fontWeight: 600 }}>{t('transit.estimatedFare')}</span>
              <span className="text-content" style={{ fontSize: 'calc(14px * var(--fs-scale-body, 1))', fontWeight: 700 }}>
                {new Intl.NumberFormat(undefined, { style: 'currency', currency: it.fare.currency, maximumFractionDigits: 0 }).format(it.fare.amount)}
              </span>
            </div>
          )}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /home/splunk/appDev/TREK/client && npx vitest run src/components/Planner/TransitSearchPanel.test.tsx`
Expected: PASS (all 9 tests: existing `FE-PLANNER-TRANSIT-001` through `006`, plus new `007`-`009`)

- [ ] **Step 8: Typecheck**

Run: `cd /home/splunk/appDev/TREK/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Manually verify in the running app**

With a Google Maps key configured, open a trip, add a Transport booking in Automated mode, search a route between two distant points (e.g. two cities), and confirm: itineraries render with line badges, an "Estimated fare" row appears when Google returns one, and "Add to day" still saves correctly. Without a key, confirm the panel behaves exactly as before (Transitous results, no fare row).

- [ ] **Step 10: Commit**

```bash
git add client/src/components/Planner/TransitSearchPanel.tsx client/src/components/Planner/TransitSearchPanel.test.tsx
git commit -m "feat(planner): use Google Directions transit search when a maps key is present, show fares"
```

---

## Task 14: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full server test suite**

Run: `cd /home/splunk/appDev/TREK/server && npx vitest run`
Expected: PASS, no regressions outside the files touched by this plan.

- [ ] **Step 2: Run the full client test suite**

Run: `cd /home/splunk/appDev/TREK/client && npx vitest run`
Expected: PASS, no regressions outside the files touched by this plan.

- [ ] **Step 3: Run both typechecks**

Run: `cd /home/splunk/appDev/TREK/server && npx tsc --noEmit && cd /home/splunk/appDev/TREK/shared && npx tsc --noEmit && cd /home/splunk/appDev/TREK/client && npx tsc --noEmit`
Expected: no errors in any of the three packages.

- [ ] **Step 4: Run the existing day-plan and transport e2e specs to confirm the no-key path is untouched**

Run: `cd /home/splunk/appDev/TREK/client && npx playwright test e2e/create-trip.spec.ts e2e/trip-planner.spec.ts`
Expected: PASS — these run with no Google Maps key configured, exercising the unchanged OSRM/Transitous path end-to-end.

- [ ] **Step 5: No commit for this task** — it's verification only. If any step fails, fix the regression in the file it points to and re-run this task's steps from the top before considering the plan complete.
