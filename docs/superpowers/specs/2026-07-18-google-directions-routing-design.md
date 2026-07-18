# Google Directions routing (BYO key)

## Problem

TREK's route generation only covers road modes (OSRM driving/walking) and
free public-transit itineraries (Transitous/MOTIS GTFS). For trips like
Tokyo → Ito, users want to compare driving against real train options
(Shinkansen vs. local, transfers, fares) the way Google Maps shows them.
Transitous gives good schedule/transfer data but weak fare coverage and
inconsistent regional feed quality; OSRM cannot route trains at all (no rail
graph).

TREK already supports a per-user, bring-your-own Google Maps API key
(`users.maps_api_key`, encrypted at rest) for Places search/autocomplete/
photos. This spec extends that same key to routing via the Google Directions
API, wired into the two places TREK currently generates routes:

1. The day view's route-profile toggle (Car/Footprints icons in
   `DayPlanSidebar.tsx`) — walking/driving distance between the day's places.
2. The transit search panel (`TransitSearchPanel.tsx`, inside
   `TransportModal.tsx`'s Automated mode) — inter-city/inter-day trip
   planning with multiple itinerary options.

## Goals

- When a user has a Google Maps API key configured, both surfaces above use
  Google Directions instead of OSRM/Transitous, transparently.
- Users without a key see zero change — OSRM/Transitous remains the default,
  untouched code path.
- The day-view toggle gains a third **Train** option (Google transit),
  visible only when a key is present.
- Admin can kill Google-routing app-wide via a new setting, independent of
  whether individual users have keys (cost-control lever).
- Responses are cached briefly to reduce billed request volume from
  re-renders/re-opens of the same day or search.

## Non-goals

- No provider picker UI (no side-by-side "Google vs Free" toggle for a
  single user) — presence of a key fully determines the provider.
- No fare display for Transitous itineraries (GTFS rarely carries fares) —
  fare only ever appears on Google-sourced itineraries, when Google returns
  one.
- No changes to OSRM/Transitous code paths themselves.

## Data model — new shared types

`shared/src/maps/directions.schema.ts` (new file):

```ts
export interface DirectionsRouteResult {
  distance: number                    // meters
  duration: number                    // seconds
  coordinates: [number, number][]     // [lat,lng], decoded from Google's overview polyline
}

export interface DirectionsTransitLeg {
  mode: string                        // WALKING | TRANSIT (Google's coarse leg modes)
  transitDetails?: {
    line: string | null
    vehicleType: string | null        // HEAVY_RAIL, SUBWAY, BUS, TRAM, ...
    departureStop: string
    arrivalStop: string
    departureTime: string             // ISO
    arrivalTime: string
    numStops: number
  }
  duration: number                    // seconds
  distance: number | null             // meters
  polyline: string | null
}

export interface DirectionsTransitItinerary {
  startTime: string                   // ISO
  endTime: string                     // ISO
  duration: number                    // seconds
  fare: { amount: number; currency: string } | null
  legs: DirectionsTransitLeg[]
}
```

`DirectionsTransitItinerary`/`Leg` are mapped into the existing client-side
`TransitItinerary`/`TransitLeg` shape (defined in `TransitSearchPanel.tsx`)
by a single mapping function at the call site. `ItineraryCard` and all
itinerary rendering/ranking code stay unchanged — they only ever see the
common shape. `fare` is additive: Transitous-sourced itineraries simply have
`fare: null`.

## Server

### `server/src/services/googleDirectionsService.ts` (new)

Mirrors the shape of `transitService.ts`.

- `route(userId: number, origin: LatLng, destination: LatLng, mode: 'driving' | 'walking'): Promise<DirectionsRouteResult>`
  - Calls the Google Directions API, decodes the response's overview
    polyline into `[lat,lng][]`.
- `transit(userId: number, origin: LatLng, destination: LatLng, departureTime: string, transitMode?: string): Promise<{ itineraries: DirectionsTransitItinerary[] }>`
  - Calls Directions API with `mode=transit`, optional single `transit_mode`
    param (`bus|subway|train|tram|rail`).
- Both use the existing `getMapsKey(userId)` from `mapsService.ts` (per-user
  key, falls back to admin key). Throw a typed `Error & { status: number }`:
  - no key resolvable → `status: 400` ("no Google Maps key configured")
  - Google `REQUEST_DENIED` / bad key → `status: 401`
  - Google `ZERO_RESULTS` → resolves with `{ itineraries: [] }` / route
    result of zero legs, not an error (matches Transitous's empty-result
    handling)
  - other Google API errors / non-2xx → `status: 502`
- In-memory TTL cache: 60s TTL, 200-entry cap, keyed by the full param
  string — identical pattern to `transitService.ts`'s `cacheGet`/`cacheSet`.

### `server/src/nest/maps/directions.controller.ts` (new)

- `@Controller('api/maps/directions')`, `@UseGuards(JwtAuthGuard)`.
- `GET /api/maps/directions` (route) — query: `origin`, `destination`,
  `mode`.
- `GET /api/maps/directions/transit` — query: `origin`, `destination`,
  `time`, `transitMode?`.
- Both routes: check new `directions_enabled` app_setting first (mirrors
  `MapsService.detailsDisabled()` etc.); if disabled, return
  `{ disabled: true }` with 200, matching the existing kill-switch response
  shape.
- Rate-limited via `RateLimitService`, reusing `TransitController`'s bucket
  sizing (60 requests / 15 min) under a new `directions_plan` bucket key.
- Errors mapped to `HttpException` via the same `toHttpException` helper
  already in `maps.controller.ts`.

### Settings / migration

- Add `directions_enabled` to the `app_settings` defaults (alongside
  `places_autocomplete_enabled` et al.), default `true`.
- Add its toggle to the admin settings UI next to the existing Places
  kill-switches (same component/pattern, just one more row).

## Client

### `client/src/api/client.ts`

- New `directionsApi.route(origin, destination, mode)` and
  `directionsApi.transit(origin, destination, time, transitMode?)`, thin
  wrappers over `apiClient.get(...)` matching `transitApi`'s existing shape.

### `client/src/components/Map/RouteCalculator.ts`

- New `calculateRouteViaGoogle(waypoints, profile: 'driving' | 'walking')`
  that calls `directionsApi.route(...)` and returns the same `RouteResult`
  shape the OSRM functions already return (distance/duration/coordinates/
  formatted text), so callers are provider-agnostic.
- `calculateRouteWithLegs` gets a dispatch at its top:
  `useAuthStore.getState().hasMapsKey ? calculateRouteViaGoogle(...) : <existing OSRM body, unchanged>`.
  `hasMapsKey` read non-reactively, matching this file's existing
  `getDistanceUnit()` pattern (reads `useSettingsStore.getState()`).
- OSRM code paths (`calculateRoute`, `calculateSegments`,
  `calculateRouteWithLegs`'s OSRM branch) are otherwise untouched.

### `client/src/components/Planner/DayPlanSidebar.tsx`

- Profile toggle's mode list becomes conditional:
  `hasMapsKey ? ['driving', 'walking', 'train'] : ['driving', 'walking']`.
- `Train` icon from `lucide-react` (already used elsewhere in the app, e.g.
  `TransportModal.tsx`) for visual consistency with the rest of TREK's
  transport iconography.
- Selecting `train` routes through `calculateRouteWithLegs(waypoints, { profile: 'train' })`.
  The `train` profile always calls the Google transit proxy — no OSRM
  fallback exists for trains, so this option simply doesn't render without a
  key.
- Departure time for the transit call: the leading place's `place_time` if
  set on that day, else `new Date()` at call time.

### `client/src/components/Planner/TransitSearchPanel.tsx`

- `search()` branches on `hasMapsKey`:
  - Google path: calls `directionsApi.transit(...)`, maps
    `DirectionsTransitItinerary[]` into the existing `TransitItinerary[]`
    shape via one mapping function local to this file.
  - Transitous path: unchanged, calls `transitApi.plan(...)` as today.
- Mode-filter chips (`MODE_GROUPS`) stay visible in both cases. On the
  Google path, the active chip set is collapsed to a single best-effort
  `transit_mode` value passed to `directionsApi.transit` (Google only
  accepts one; TREK's finer groups map onto Google's `bus|subway|train|
  tram|rail`, dropping ferry/cable which Google's `transit_mode` doesn't
  support — those chips are simply inert on the Google path).
- Everything downstream (`ItineraryCard`, `pref` ranking, `addItinerary`)
  is untouched — it only consumes the common `TransitItinerary` shape.
  `fare`, when present, renders as an additional line on `ItineraryCard`
  (small addition to that component — the only rendering change in this
  file's dependents).

## Error handling

| Condition | Behavior |
|---|---|
| No key resolvable (shouldn't reach client — gated by `hasMapsKey`) | Server 400, defensive only |
| Bad/revoked key (`REQUEST_DENIED`) | Server 401 → client toast, generic error copy matching existing Google Places failure UX. No fallback to OSRM/Transitous (avoids silently-different results confusing the user). |
| `ZERO_RESULTS` | Empty itinerary list / empty route — same empty-state UI already used for Transitous's no-results case |
| `directions_enabled` off | 200 `{ disabled: true }` → client shows the same "feature disabled" treatment `PlaceFormModal` already has for the `hasMapsKey`-gated import button |
| Rate limit exceeded | 429 → toast, retry-later copy, same as `TransitController`'s existing behavior |

## Testing

- **Server**: `googleDirectionsService.test.ts` (new) — mocked `fetch`,
  covering polyline decode, cache hit/miss, each error-status mapping;
  structured like `transitService.test.ts`. `directions.controller.test.ts`
  (new) — kill-switch short-circuit, rate limit, auth guard; structured like
  `transit.controller.test.ts`.
- **Client**: `RouteCalculator.test.ts` — new msw-mocked cases for
  `calculateRouteViaGoogle`, alongside existing OSRM msw cases.
  `TransitSearchPanel.test.tsx` — new case with `hasMapsKey: true` verifying
  the Google path is called and itineraries (incl. fare) render correctly.
- **E2E**: none required — existing day-plan and transport e2e specs run
  with no key configured, exercising the untouched OSRM/Transitous path.

## Open risks

- Google Directions billing is per-request; the 60s cache mitigates but
  does not eliminate cost exposure for active users. The `directions_enabled`
  kill-switch is the escape hatch if costs become a concern.
- Google's `transit_mode` is coarser than Transitous's mode groups (no
  ferry/cable equivalent) — accepted as a known gap per the design
  discussion, not a blocker.
