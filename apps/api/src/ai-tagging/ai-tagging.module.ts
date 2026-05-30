import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { AiTaggingController } from './ai-tagging.controller';
import { AiTaggingService } from './ai-tagging.service';

@Module({
  imports: [LlmModule],
  controllers: [AiTaggingController],
  providers: [AiTaggingService],
  exports: [AiTaggingService],
})
export class AiTaggingModule {}
