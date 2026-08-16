import { Module } from '@nestjs/common';
import { RubricsController } from './rubrics.controller';
import { RubricsService } from './rubrics.service';

@Module({
  controllers: [RubricsController],
  providers: [RubricsService],
  exports: [RubricsService],
})
export class RubricsModule {}
