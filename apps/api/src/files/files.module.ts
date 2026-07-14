import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

/**
 * Módulo genérico de archivos. Orquesta `StorageService` (S3) + la tabla `files`
 * para ofrecer un CRUD de archivos desacoplado y reutilizable. Exporta
 * `FilesService` para que otros módulos (ej. `instruments`) lo consuman in-process.
 */
@Module({
  imports: [StorageModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
