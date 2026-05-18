import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectDb, type Database } from '../database/database.types';

@Controller('health')
export class HealthController {
  constructor(@InjectDb() private readonly db: Database) {}

  @Get()
  async check() {
    let dbStatus = 'unknown';
    try {
      await this.db.execute(sql`SELECT 1`);
      dbStatus = 'ok';
    } catch (err) {
      dbStatus = `error: ${(err as Error).message}`;
    }

    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
      },
    };
  }
}
