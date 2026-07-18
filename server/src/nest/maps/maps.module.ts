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
