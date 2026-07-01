import { config } from 'dotenv';

// Load base dev file first, then `.env` with override so local secrets / DATA_SYNC_CRON_*
// win and are not stuck on empty values from an earlier parse.
config({ path: '.env.development' });
config({ path: '.env', override: true });

import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { parseCorsOriginsList } from './config/app-urls';
import { normalizeApiGlobalPrefix } from './config/configuration';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const apiPrefix = normalizeApiGlobalPrefix(process.env.API_GLOBAL_PREFIX);
  if (apiPrefix) {
    app.setGlobalPrefix(apiPrefix);
  }
  const corsAllowed = parseCorsOriginsList(process.env.CORS_ORIGIN);
  const routeBase = apiPrefix ? `/${apiPrefix}` : '';
  logger.log(
    `API routes: base URL path "${routeBase || '/'}" (set API_GLOBAL_PREFIX=api if your app calls e.g. /api/formulas/...)`,
  );
  logger.log(
    `Env after ConfigModule load: GEMINI_API_KEY=${process.env.GEMINI_API_KEY ? 'SET' : 'NOT SET'}, cwd=${process.cwd()}`,
  );
  logger.log(
    `CORS: ${corsAllowed.length} allowed origin(s): ${corsAllowed.join(', ')}`,
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: (
      reqOrigin: string | undefined,
      callback: (err: Error | null, allow?: string | boolean) => void,
    ) => {
      if (!reqOrigin) {
        return callback(null, true);
      }
      if (corsAllowed.includes(reqOrigin)) {
        return callback(null, reqOrigin);
      }
      // Reject without passing Error: callback(err) can surface as 500 on OPTIONS preflight in Express.
      return callback(null, false);
    },
    credentials: true,
  });
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}

bootstrap();
