import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Módulo de almacenamiento de archivos (S3 vía presigned URLs). Provee
 * `StorageService` a los módulos que necesitan subir/descargar archivos
 * directamente contra S3 sin pasarlos por el backend (CLAUDE.md §11).
 */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
