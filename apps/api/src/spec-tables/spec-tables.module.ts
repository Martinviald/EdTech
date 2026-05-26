import { Module } from '@nestjs/common';
import { SpecTablesController } from './spec-tables.controller';
import { SpecTablesService } from './spec-tables.service';

@Module({
  controllers: [SpecTablesController],
  providers: [SpecTablesService],
  exports: [SpecTablesService],
})
export class SpecTablesModule {}
