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
