import { Module } from '@nestjs/common';
import { InstrumentsModule } from '../instruments/instruments.module';
import { ItemsModule } from '../items/items.module';
import { ItemCollectionsController } from './item-collections.controller';
import { ItemCollectionsService } from './item-collections.service';

@Module({
  imports: [ItemsModule, InstrumentsModule],
  controllers: [ItemCollectionsController],
  providers: [ItemCollectionsService],
  exports: [ItemCollectionsService],
})
export class ItemCollectionsModule {}
