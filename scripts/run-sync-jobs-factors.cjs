const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.development') });
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });

async function run() {
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/src/app.module');
  const { JobsService } = require('../dist/src/jobs/jobs.service');

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const asOfDateArg = args.find((a) => a.startsWith('--as-of-date='));
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const offsetArg = args.find((a) => a.startsWith('--offset='));

  const asOfDate = asOfDateArg ? asOfDateArg.split('=')[1] : undefined;
  const limit = limitArg ? Number.parseInt(limitArg.split('=')[1], 10) : undefined;
  const offset = offsetArg ? Number.parseInt(offsetArg.split('=')[1], 10) : undefined;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const jobsService = app.get(JobsService);
    const result = await jobsService.syncJobsFactors({
      asOfDate,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
      dryRun,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
