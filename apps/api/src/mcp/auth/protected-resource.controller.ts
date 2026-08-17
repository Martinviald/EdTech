import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@Controller('.well-known')
export class ProtectedResourceController {
  constructor(private readonly config: ConfigService) {}

  @Get('oauth-protected-resource')
  getMetadata() {
    if (this.config.get<string>('MCP_ENABLED', 'false') !== 'true') {
      throw new NotFoundException();
    }
    return {
      resource: this.config.getOrThrow<string>('MCP_CANONICAL_URI'),
      authorization_servers: [this.config.getOrThrow<string>('WORKOS_ISSUER')],
      bearer_methods_supported: ['header'],
    };
  }
}
