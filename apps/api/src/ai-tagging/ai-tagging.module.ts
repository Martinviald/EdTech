import { Module } from '@nestjs/common';
import { AiTaggingController } from './ai-tagging.controller';
import { AiTaggingService } from './ai-tagging.service';
import { AnthropicClient } from './lib/anthropic-client';

@Module({
  controllers: [AiTaggingController],
  providers: [AiTaggingService, AnthropicClient],
  exports: [AiTaggingService],
})
export class AiTaggingModule {}
