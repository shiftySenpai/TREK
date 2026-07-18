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
