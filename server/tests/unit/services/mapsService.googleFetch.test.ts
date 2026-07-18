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
