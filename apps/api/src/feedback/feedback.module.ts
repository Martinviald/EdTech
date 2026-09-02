import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { StorageModule } from '../storage/storage.module';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

/**
 * Feedback in-app. Reutiliza `FilesModule` in-process para las capturas de
 * pantalla (S3 vía presigned) en vez de exponer un segundo mecanismo de subida.
 */
@Module({
  imports: [FilesModule, StorageModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
