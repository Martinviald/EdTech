import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createDbClient, type Database } from '@soe/db';

export const DATABASE_CONNECTION = 'DATABASE_CONNECTION';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: DATABASE_CONNECTION,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Database => {
        const databaseUrl = configService.get<string>('DATABASE_URL');
        if (!databaseUrl) {
          throw new Error('DATABASE_URL is required');
        }
        return createDbClient(databaseUrl);
      },
    },
  ],
  exports: [DATABASE_CONNECTION],
})
export class DatabaseModule {}
