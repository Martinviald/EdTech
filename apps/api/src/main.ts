import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error', 'debug'],
  });

  // HTTP request logger (dev only)
  if (process.env.NODE_ENV !== 'production') {
    const httpLogger = new Logger('HTTP');
    app.use((req: { method: string; url: string }, res: { statusCode: number; on: (e: string, cb: () => void) => void }, next: () => void) => {
      const { method, url } = req;
      const start = Date.now();
      res.on('finish', () => {
        httpLogger.log(`${method} ${url} → ${res.statusCode} (${Date.now() - start}ms)`);
      });
      next();
    });
  }
  const configService = app.get(ConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: configService.get<string>('CORS_ORIGIN', 'http://localhost:3000'),
    credentials: true,
  });

  const port = configService.get<number>('API_PORT', 4000);
  await app.listen(port);

  Logger.log(`🚀 API running on http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap().catch((err) => {
  Logger.error(err, 'Bootstrap');
  process.exit(1);
});
