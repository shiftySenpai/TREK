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
