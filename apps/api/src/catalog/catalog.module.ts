import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CatalogController } from './catalog.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [CatalogController],
})
export class CatalogModule {}
