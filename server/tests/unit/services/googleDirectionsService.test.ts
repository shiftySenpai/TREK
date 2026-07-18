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
    await expect(route(1, '48.10,11.50', '48.20,11.60', 'driving')).rejects.toMatchObject({ status: 401 });
  });

  it('GDIR-SVC-006: a non-OK HTTP response surfaces as a 502-style error', async () => {
    getMapsKeyMock.mockReturnValue('KEY123');
    googleFetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    await expect(route(1, '41.00,2.00', '41.10,2.10', 'driving')).rejects.toMatchObject({ status: 502 });
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
    expect(url).toContain('departure_time=1783929600'); // 2026-07-13T08:00:00Z in unix seconds
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

  // NOTE: distinct coordinates per network-reaching test — the module-level cache
  // is keyed by origin:destination:depSeconds:modes and persists across it() blocks,
  // so reusing validArgs here would let GDIR-SVC-011's cached success poison these.
  it('GDIR-SVC-012: ZERO_RESULTS resolves to an empty itinerary list', async () => {
    getMapsKeyMock.mockReturnValue('KEY123');
    googleFetchMock.mockResolvedValueOnce(okJson({ status: 'ZERO_RESULTS' }));
    const r = await transit(1, '35.00,139.00', '35.10,139.10', '2026-07-13T08:00:00Z');
    expect(r.itineraries).toEqual([]);
  });

  it('GDIR-SVC-013: REQUEST_DENIED surfaces as a 401-style error', async () => {
    getMapsKeyMock.mockReturnValue('KEY123');
    googleFetchMock.mockResolvedValueOnce(okJson({ status: 'REQUEST_DENIED' }));
    await expect(transit(1, '40.00,-3.00', '40.10,-3.10', '2026-07-13T08:00:00Z')).rejects.toMatchObject({ status: 401 });
  });
});
