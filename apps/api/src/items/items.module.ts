import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  // La figura del ítem (banda recortada del PDF) se almacena vía el módulo
  // genérico `files`, igual que el PDF del enunciado en `instruments.module.ts`.
  imports: [FilesModule],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
