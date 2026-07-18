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
