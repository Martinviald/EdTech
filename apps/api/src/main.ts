import 'reflect-metadata';
import compression from 'compression';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { DATABASE_CONNECTION } from './database/database.module';
import type { Database } from './database/database.types';
import { checkRlsEnforcement } from './database/rls-startup-check';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'warn', 'error', 'debug'],
  });
  app.useBodyParser('json', { limit: '8mb' });

  // Las respuestas de analítica son JSON grande y repetitivo. CloudFront ya comprime
  // lo que llega al navegador, pero no este hop: el front lo consume server-side
  // (Lambda -> App Runner) y el servidor MCP pega directo a la API por internet.
  app.use(compression());

  // HTTP request logger (dev only)
  if (process.env.NODE_ENV !== 'production') {
    const httpLogger = new Logger('HTTP');
    app.use(
      (
        req: { method: string; url: string },
        res: { statusCode: number; on: (e: string, cb: () => void) => void },
        next: () => void,
      ) => {
        const { method, url } = req;
        const start = Date.now();
        res.on('finish', () => {
          httpLogger.log(`${method} ${url} → ${res.statusCode} (${Date.now() - start}ms)`);
        });
        next();
      },
    );
  }
  const configService = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api', {
    exclude: ['mcp', '.well-known/oauth-protected-resource'],
  });
  app.enableCors({
    origin: configService.get<string>('CORS_ORIGIN', 'http://localhost:3000'),
    credentials: true,
  });

  // Self-check de aislamiento multi-tenant: avisa si la conexión bypassa RLS.
  await checkRlsEnforcement(app.get<Database>(DATABASE_CONNECTION));

  const port = configService.get<number>('API_PORT', 4000);
  await app.listen(port);

  Logger.log(`🚀 API running on http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap().catch((err) => {
  Logger.error(err, 'Bootstrap');
  process.exit(1);
});
